/**
 * The page's eager bundle: what `index.html` loads on every visit, its
 * entry script and each chunk it modulepreloads. DataScript is the query
 * worker's alone (DESIGN-UI.md → Replica queries), so no eager chunk may
 * carry it; and the whole set stays inside a byte budget, so a win on the
 * page's first load stays won (DESIGN-UI.md → Delivery).
 *
 * The property is the bundler's, not the import graph's: a module reachable
 * from the page is dropped when no export of it is used, so only a build can
 * say what the page carries. This builds the UI into a scratch directory.
 *
 * Red case: export `DatascriptIndex` from `@kb/ui-sdk`'s index again (its namespace
 * is the page's `kb-ext-sdk` host module, so every export of it is live).
 */
import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { UI_ROOT } from "../src/paths.ts";

/** DataScript is compiled ClojureScript: its runtime names `cljs.core` throughout, and nothing else of kb's does. */
const DATASCRIPT = /cljs\.core/;

/**
 * The eager set's raw bytes may not pass this (1.76 MB when it was set, from
 * 2.23 MB with DataScript; raised by 10 KB for the motion options' seed
 * fields and their mode, whose painter and Preferences rows load lazily).
 */
const EAGER_BUDGET_BYTES = 1_960_000;

/** The chunks `index.html` loads before anything else: its module scripts and modulepreloads. */
function eagerChunks(html: string): string[] {
  const scripts = [...html.matchAll(/<script[^>]*type="module"[^>]*src="([^"]+)"/g)];
  const preloads = [...html.matchAll(/<link[^>]*rel="modulepreload"[^>]*href="([^"]+)"/g)];
  return [...scripts, ...preloads].map((m) => m[1] ?? "").filter((src) => src.startsWith("/"));
}

describe("the page's eager bundle", () => {
  test("carries no DataScript, and stays inside its byte budget", async () => {
    const out = await mkdtemp(join(tmpdir(), "kb-page-bundle-"));
    try {
      const build = Bun.spawnSync(["bun", "x", "vp", "build", "--outDir", out, "--emptyOutDir"], {
        cwd: UI_ROOT,
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(build.exitCode, build.stderr.toString()).toBe(0);

      const chunks = eagerChunks(await readFile(join(out, "index.html"), "utf8"));
      expect(chunks.length, "index.html loads an entry and preloads its chunks").toBeGreaterThan(1);

      let bytes = 0;
      const withDataScript: string[] = [];
      for (const chunk of chunks) {
        const code = await readFile(join(out, chunk), "utf8");
        bytes += Buffer.byteLength(code);
        if (DATASCRIPT.test(code)) withDataScript.push(chunk);
      }
      expect(withDataScript, "an eager chunk carries DataScript").toEqual([]);
      expect(bytes, `the eager set is ${bytes} bytes`).toBeLessThanOrEqual(EAGER_BUDGET_BYTES);
    } finally {
      await rm(out, { recursive: true, force: true });
    }
  }, 120_000);
});
