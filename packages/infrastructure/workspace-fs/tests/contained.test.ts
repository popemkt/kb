/**
 * Canonical-path containment, said once (`contained.ts`): a path inside a
 * directory is the directory's only if, its links followed, it stays there.
 */
import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem";
import { containedDirectory } from "../src/index.ts";

const contained = (root: string, candidate: string) =>
  Effect.runPromise(containedDirectory(root, candidate).pipe(Effect.provide(BunFileSystem.layer)));

describe("a directory inside another", () => {
  test("is its real path when it stays inside, and nothing when it climbs or links out", async () => {
    const at = await realpath(await mkdtemp(join(tmpdir(), "kb-contained-")));
    const root = join(at, "root");
    await mkdir(join(root, "packages", "a"), { recursive: true });
    await mkdir(join(at, "outside"), { recursive: true });
    await symlink(join(at, "outside"), join(root, "packages", "out"));
    await symlink(join(root, "packages", "a"), join(root, "packages", "alias"));
    await writeFile(join(root, "file.txt"), "not a directory");

    expect(await contained(root, join(root, "packages", "a"))).toBe(join(root, "packages", "a"));
    expect(await contained(root, join(root, "packages", "alias"))).toBe(
      join(root, "packages", "a"),
    );
    expect(await contained(root, join(root, "..", "outside"))).toBeNull();
    expect(await contained(root, join(root, "packages", "out"))).toBeNull();
    expect(await contained(root, join(root, "file.txt"))).toBeNull();
    expect(await contained(root, join(root, "missing"))).toBeNull();
  });
});
