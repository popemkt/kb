/**
 * The agent skill kb ships (DESIGN.md → Surfaces, "The agent skill") names
 * actions and commands, and an agent acts on those names as written. This
 * holds each one to what kb has: an action id to a registered action under
 * its own id (an alias is never listed, so the skill names none), and a
 * `kb <command>` to a command of the CLI.
 */
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { bunFileSystemLayer, registryFor } from "@kb/runtime";
import { KB_SOURCE_BIN } from "@kb/test-kit";

const SKILL = join(import.meta.dir, "../../../../skills/kb/SKILL.md");

let root: string;
let text: string;
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "kb-skill-"));
  text = await readFile(SKILL, "utf8");
});
afterAll(() => rm(root, { recursive: true, force: true }));

/** Every code span of the skill, as written. */
const spans = () => [...text.matchAll(/`([^`\n]+)`/g)].flatMap(([, span]) => span ?? []);

test("the skill is named kb and says when to use it", () => {
  const front = /^---\nname: kb\ndescription: (.+)\n---\n/.exec(text);
  expect(front?.[1]?.length ?? 0).toBeGreaterThan(80);
});

test("every action the skill names is registered under that id", async () => {
  const registry = await Effect.runPromise(
    registryFor(root).pipe(Effect.provide(bunFileSystemLayer)),
  );
  const entries = new Map(registry.manifestEntries().map((entry) => [entry.id, entry]));
  const named = spans().filter(
    (span) => /^[a-z][a-zA-Z]*(\.[a-z][a-zA-Z]*)+$/.test(span) && !span.startsWith("sys."),
  );
  expect(named.length).toBeGreaterThan(30);
  const wrong = named.filter((id) => entries.get(id)?.aliasOf !== undefined || !entries.has(id));
  expect(wrong).toEqual([]);
});

test("every kb command the skill names is a command of the CLI", async () => {
  const help = Bun.spawnSync([KB_SOURCE_BIN, "--help"], { stdout: "pipe", stderr: "pipe" });
  const commands = new Set(
    help.stdout
      .toString()
      .split("Commands:")[1]
      ?.split("\n")
      .flatMap((line) => /^ {2}([a-z][a-z-]*)/.exec(line)?.[1] ?? []),
  );
  expect(commands.size).toBeGreaterThan(20);
  const named = spans().flatMap((span) => /^kb ([a-z][a-z-]*)/.exec(span)?.[1] ?? []);
  expect(named.length).toBeGreaterThan(15);
  expect(named.filter((command) => !commands.has(command))).toEqual([]);
});
