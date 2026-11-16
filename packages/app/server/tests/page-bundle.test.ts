/**
 * The page's eager bundle: what `index.html` loads on every visit, its
 * entry script and each chunk it modulepreloads. DataScript is the query
 * worker's alone (DESIGN-UI.md → Replica queries), so no eager chunk may
 * carry it; and the whole set stays inside a byte budget, so a win on the
 * page's first load stays won (DESIGN-UI.md → Delivery).
 *
 * The property is the bundler's, not the import graph's: a module reachable
 * from the page is dropped when no export of it is used, so only a build can
 * say what the page carries. This builds the UI into a scratch directory,
 * as the page ships it: a production build, which names no path of the
 * checkout, so the measure is the same wherever the checkout lives.
 *
 * Red case: export `DatascriptIndex` from `@kb/ui-sdk`'s index again (its namespace
 * is the page's `kb-ext-sdk` host module, so every export of it is live).
 */
import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { UI_ROOT } from "../src/paths.ts";

/** The checkout the page is built from: no byte of what it ships may depend on where it lives. */
const CHECKOUT = resolve(UI_ROOT, "..", "..", "..");

/** DataScript is compiled ClojureScript: its runtime names `cljs.core` throughout, and nothing else of kb's does. */
const DATASCRIPT = /cljs\.core/;

/**
 * The eager set's raw bytes may not pass the `page-eager` budget's `bytes`
 * limit, which the harness's ledger states and answers (DESIGN.md →
 * Budgets); its history is the base's reason and the change files.
 */
function eagerBudgetBytes(): number {
  const ask = Bun.spawnSync(
    ["bun", join(CHECKOUT, "harness/src/budgets.ts"), "limit", "page-eager", "bytes"],
    { cwd: CHECKOUT, stdout: "pipe", stderr: "pipe" },
  );
  if (ask.exitCode !== 0) throw new Error(`the page-eager budget: ${ask.stderr.toString()}`);
  return Number(ask.stdout.toString().trim());
}

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
      // The build the page ships (`bun run build` sets no NODE_ENV, so Vite's
      // production mode): not the test-mode build `bun test`'s NODE_ENV would ask
      // for, which names each module's absolute path.
      const build = Bun.spawnSync(["bun", "x", "vp", "build", "--outDir", out, "--emptyOutDir"], {
        cwd: UI_ROOT,
        env: { ...process.env, NODE_ENV: "production" },
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(build.exitCode, build.stderr.toString()).toBe(0);

      const chunks = eagerChunks(await readFile(join(out, "index.html"), "utf8"));
      expect(chunks.length, "index.html loads an entry and preloads its chunks").toBeGreaterThan(1);

      let bytes = 0;
      const withDataScript: string[] = [];
      const withCheckout: string[] = [];
      for (const chunk of chunks) {
        const code = await readFile(join(out, chunk), "utf8");
        bytes += Buffer.byteLength(code);
        if (DATASCRIPT.test(code)) withDataScript.push(chunk);
        if (code.includes(CHECKOUT)) withCheckout.push(chunk);
      }
      expect(withDataScript, "an eager chunk carries DataScript").toEqual([]);
      // What is measured is what ships, wherever the checkout lives.
      expect(withCheckout, "an eager chunk names the checkout's path").toEqual([]);
      expect(bytes, `the eager set is ${bytes} bytes`).toBeLessThanOrEqual(eagerBudgetBytes());
    } finally {
      await rm(out, { recursive: true, force: true });
    }
  }, 120_000);
});
