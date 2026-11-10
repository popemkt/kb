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
 * The eager set's raw bytes may not pass this. The history below is of the
 * test-mode build, whose numbers ran about 260 KB above what ships (1.76 MB when it was set, from
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
 * lazily, its package being free of side effects. And by 2 KB for the
 * composer's declaration: its seven workflow views, each key carrying the
 * question, steps and tags the chooser reads, and the `#look` tag and its
 * fields; every workflow's surface loads lazily. And by 1 KB for the
 * replica's `StoreState`: the page's store keeps the node set it settles
 * sibling ranks over, and `rankTx` reads it through an overlay, rather than
 * rebuilding a map of every node per optimistic write. And by 4 KB for the
 * scroll region's overlay scrollbar, which every pane frame draws, and the
 * model's `backdropArtOf`, which reads a backdrop's art as an image or an
 * art manifest; the medallion's shaders and glyph atlas load lazily. And by
 * 2 KB for the gallery's 3D seed in its declaration: the `made with`, `seen
 * in` and `how to` fields, three source kinds and ten 3D sources; the 3D
 * starter is the server's, and the art-direction export loads lazily. And
 * by 25 KB for a tag's opening and its display options: the tag default in
 * the resolver and the ways a node opens (`nodeOpenings`, moved from the
 * pane switcher into `@kb/views`), the node menu's "Open in …", "Open with"
 * and display rows, the tag chip's ↗ segment, the bullet's menu gesture,
 * the row's preview box (`row-preview.tsx`) and the display settings'
 * fields; the canvas's preview picture loads lazily, as its page does. And
 * by 3 KB for a tab that outlives its build: `lib/stale-build` (the build a
 * hello names and the chunk that did not arrive, through one guard), the
 * socket's `onBuild` and the header's "kb was updated" notice, which must be
 * there before any page's chunk is asked for. And by 2 KB for backdrop
 * variants: the model's variant field and option kind, `shownVariants`,
 * `BackdropFrame`'s pinned set and its row in Settings.
 * And by 1 KB for Astral's declaration, its key and its four variants;
 * its scene loads lazily. And by 100 bytes (71 measured) for the Black
 * hole's two variants on its key; its looks load lazily. And by 7.4 KB
 * (7,367 bytes measured) for the backdrops' knobs: each moving backdrop's
 * declared knobs (3.6 KB over fourteen), their fold into the seed's fields
 * and a page head's values (`knob-fields`, 1.7 KB), and what Sky, drawn
 * with the page, reads of its own (1 KB); the knob control loads lazily.
 * And by 3 KB (3,000 bytes measured) for Backdrop Studio: a backdrop's card
 * is the kit's, which every gallery of backdrops draws (1.4 KB; deferred, it
 * split the kit's eager chunks and cost 2.1 KB more), and the Studio's route,
 * surface and view option, which the page reads to route (0.9 KB); the
 * Studio's page and scenes load lazily. And by 3.5 KB (3,442 bytes
 * measured) for a page head's backdrop offering "Open in Studio": the
 * gesture that hears a double-click on the head (1.3 KB), the corner it
 * opens (1.5 KB; deferred, it split the kit's eager chunks and cost 0.95 KB
 * more) and the head's hold of it (0.4 KB).
 * And by 10.7 KB (10,633 bytes measured) for reviewing and trusting
 * extensions wherever an approval appears, since a trust card can come up on
 * any page: the review evidence and its line diff (#125, 4.7 KB); the menu
 * surface the kit now owns, an extension row's origin and status words
 * (3.5 KB); what an extension says about itself, its manifest's shape and
 * capabilities in words on that card (2.3 KB); and the merge's own 0.1 KB.
 * Settings itself loads lazily.
 */
// The routines family adds its native field/tag vocabulary; its worker remains server-side.
// PointSpec metadata and host/cardinality admission add 1,121 measured eager bytes.
// Manifest replacement admission and the served field-row SDK add 2,053 measured eager bytes.
// Commit receipts, reaction frames and identified actor metadata add 3,246 measured eager bytes.
// Shared capability metadata, manifest constraints and waiting status add 6,246 measured eager bytes.
// The integrated editor, roles and routines surfaces measure 2,064,033 eager bytes.
// The days family adds 12,724 measured eager bytes (2,062,465 → 2,075,189): its
// declaration and seed, which the page folds, its day page, Today row and
// command, and core's capture-target and landing roles with their defaults.
// The day page loads lazily, which takes 2,268 measured eager bytes back
// (2,075,518 → 2,073,250); the family's plugin, row, command and roles stay.
// With #151's ownership rule merged the set measures 2,074,060 bytes; the
// budget keeps 1.5 KB of headroom over it.
// Tag extension measures 2,078,173 in CI (173 over 2,078,000): `sys.f.extends`
// in the seed the page folds, and the one memoized reader of a node's kinds
// (`tagChains`); the budget is that number plus about 1.5 KB.
// Measured on the build the page ships (NODE_ENV=production) since the test
// spawns it so, rather than the test-mode build every number above was taken
// on: the same tree measures 1,810,346 eager bytes from ~/Projects/… and from
// /tmp/…, and the budget keeps about 1.5 KB of headroom over it. A raise from
// here is a production measurement.
// Days' period tag settings and the day page's sections point measure
// 1,812,739: the two settings and their guard, which the page folds and
// loads, and the point's declaration with days' sections' lazy loaders
// (their bodies are chunks of their own), measured with both sections. The budget keeps about 1.5 KB
// of headroom over it.
// One backdrop across pages adds the pane's host above the router, its layers' crossfade and
// hold, a head's declaration of its space and the breadcrumbs' band; every scene still loads lazily.
// It measures 5,500 production bytes (1,812,739 → 1,818,239 merged with main at b62fcb17); the
// budget keeps about 1.5 KB of headroom over it.
const EAGER_BUDGET_BYTES = 1_819_700;

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
      expect(bytes, `the eager set is ${bytes} bytes`).toBeLessThanOrEqual(EAGER_BUDGET_BYTES);
    } finally {
      await rm(out, { recursive: true, force: true });
    }
  }, 120_000);
});
