import { randomUUID } from "node:crypto";
import { beforeEach } from "bun:test";
/**
 * Every `bun test` run has its own home store (DESIGN.md → Locations): `kb
 * init` and `kb ui` register the root they open in the person's home store,
 * and a test that runs either must never write to the person's own, nor to
 * whatever `KB_HOME` the shell running the tests names. Preloaded by
 * `bunfig.toml`, before any test reads its environment; a test that needs a
 * home of its own sets `KB_HOME` again for itself. A child a test spawns
 * without passing its environment on misses this, and resolving the home
 * there fails (`NODE_ENV=test` and no `KB_HOME`) rather than reach the
 * person's (`@kb/workspace-fs`'s `homePath`).
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pointHomeAt } from "./home-env.ts";

pointHomeAt(mkdtempSync(join(tmpdir(), "kb-test-home-")));

// Trust is shared between roots inside a test, and isolated between tests.
const dataRoot = mkdtempSync(join(tmpdir(), "kb-test-data-"));
// oxlint-disable-next-line node/no-process-env -- this preload owns the test run's data environment
const env = process.env;
env.KB_DATA = join(dataRoot, "setup");
beforeEach(() => {
  env.KB_DATA = join(dataRoot, randomUUID());
});
