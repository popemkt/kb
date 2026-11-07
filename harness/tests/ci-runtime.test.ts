import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WORKSPACE_ROOT } from "../src/workspace.ts";

test("CI scope retains runtime gates for a rename into docs", () => {
  const cwd = mkdtempSync(join(tmpdir(), "kb-ci-scope-"));
  const git = (...args: string[]) => {
    const result = Bun.spawnSync(["git", ...args], { cwd });
    expect(result.exitCode, result.stderr.toString()).toBe(0);
    return result.stdout.toString().trim();
  };
  const scope = (base: string) => {
    const result = Bun.spawnSync([join(WORKSPACE_ROOT, "bin/ci-runtime"), base, "HEAD"], { cwd });
    expect(result.exitCode, result.stderr.toString()).toBe(0);
    return result.stdout.toString().trim();
  };
  try {
    git("init", "-q");
    git("config", "user.email", "ci@example.test");
    git("config", "user.name", "CI scope test");
    mkdirSync(join(cwd, "packages"));
    mkdirSync(join(cwd, "docs"));
    writeFileSync(join(cwd, "packages/x.ts"), "export const value = 1;\n");
    git("add", ".");
    git("commit", "-qm", "base");
    const base = git("rev-parse", "HEAD");
    git("mv", "packages/x.ts", "docs/x.md");
    git("commit", "-qm", "rename into prose");
    expect(scope(base)).toBe("true");
    const renamed = git("rev-parse", "HEAD");
    writeFileSync(join(cwd, "docs/x.md"), "Prose alone.\n");
    git("commit", "-qam", "edit prose");
    expect(scope(renamed)).toBe("false");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
