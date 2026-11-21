import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WORKSPACE_ROOT } from "../src/workspace.ts";

const cwd = mkdtempSync(join(tmpdir(), "kb-ci-scope-"));
afterAll(() => rmSync(cwd, { recursive: true, force: true }));

const git = (...args: string[]) => {
  const result = Bun.spawnSync(["git", ...args], { cwd });
  expect(result.exitCode, result.stderr.toString()).toBe(0);
  return result.stdout.toString().trim();
};

/** `bin/ci-scope`'s answer, as the gate → selected map Validate reads. */
const scope = (...range: string[]) => {
  const result = Bun.spawnSync([join(WORKSPACE_ROOT, "bin/ci-scope"), ...range], { cwd });
  expect(result.exitCode, result.stderr.toString()).toBe(0);
  return Object.fromEntries(
    result.stdout
      .toString()
      .trim()
      .split("\n")
      .map((line) => {
        const [gate, selected] = line.split("=");
        return [gate, selected === "true"];
      }),
  );
};

git("init", "-q");
git("config", "user.email", "ci@example.test");
git("config", "user.name", "CI scope test");
mkdirSync(join(cwd, "packages"));
mkdirSync(join(cwd, "docs"));
writeFileSync(join(cwd, "packages/x.ts"), "export const value = 1;\n");
git("add", ".");
git("commit", "-qm", "base");

/** Commit a change on top of HEAD and return the base it was made on. */
const change = (message: string, make: () => void) => {
  const base = git("rev-parse", "HEAD");
  make();
  git("add", "-A");
  git("commit", "-qm", message);
  return base;
};

test("CI scope retains runtime gates for a rename into docs", () => {
  const renamed = change("rename into prose", () => git("mv", "packages/x.ts", "docs/x.md"));
  expect(scope(renamed, "HEAD").runtime).toBe(true);
  const prose = change("edit prose", () => writeFileSync(join(cwd, "docs/x.md"), "Prose alone.\n"));
  expect(scope(prose, "HEAD").runtime).toBe(false);
});

test("a push, which names no range, selects every gate", () => {
  const gates = scope();
  expect(Object.keys(gates).length).toBeGreaterThan(0);
  expect(Object.values(gates).every(Boolean)).toBe(true);
});
