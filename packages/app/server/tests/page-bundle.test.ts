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
 * fields and their mode, whose painter loads lazily, as the Settings page does;
 * raised by 3 KB for the backdrop gallery's eager half, core's backdrop
 * preview and the SDK's BackdropFrame and HoldStill, whose card loads lazily;
 * raised by 1 KB for the page's counted events, the host's read of them and
 * the backdrops' one bridge that tells them to a scene, every scene's own
 * code loading lazily; raised by 1 KB for a backdrop's art setting: the
 * model's art field and choice, `assetUrl`, and its row in Settings).
 * And by 4 KB for the gallery family's declaration (its ids and its seed:
 * four tags, their fields and six image sources), which the page folds as
 * it folds every family's; its page, readings and action schemas load
 * lazily, its package being free of side effects.
 */
const EAGER_BUDGET_BYTES = 1_969_000;

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
      // GAP [[01M66K9DRY5A9RYHFD99QCQTE8]] a test-mode build, whose size grows with the checkout's path
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
