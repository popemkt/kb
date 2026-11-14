import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { markUiBuilt, startUi } from "@kb/server";
import { FIXTURE_TIMESTAMP, renderFixtureNodes } from "../fixture.ts";
import { bundledSeed } from "@kb/bundled";
import { extensionNodeId, SYSTEM_IDS, type KbNode } from "@kb/model";
import { writeTrustedExample } from "@kb/test-kit";
import { EXAMPLE_ARG, HOSTED_ARG } from "../harness-server.ts";

/*
 * The harness's server, run by Bun (`harness-server.ts` spawns it), so it
 * compiles against Bun alone: the specs beside the fixture compile against
 * a DOM, for what they evaluate in the page.
 *
 * The store a spec sees is the system seed plus the render fixture, and
 * nothing else. It is built from `bundledSeed()` rather than copied from
 * the working tree's `.kb`, so what a spec counts cannot move when someone
 * adds a node to the repo's knowledge base.
 */
const scratchRoot = await mkdtemp(join(tmpdir(), "kb-render-harness-"));
const scratchKb = join(scratchRoot, ".kb");
await mkdir(scratchKb);
/*
 * The specs are about core and the projections, so the store has the days
 * family switched off, as a person may switch it: a page that opens at the
 * root shows home and a capture goes to the top level (DESIGN.md → Days).
 */
const DAYS_NODE = extensionNodeId("days");
const switchedOff = (node: KbNode): KbNode =>
  node.id === DAYS_NODE
    ? {
        ...node,
        props: { ...node.props, [SYSTEM_IDS.extensionEnabledField]: [{ t: "bool", v: false }] },
      }
    : node;
const fixtureNodes = [...bundledSeed(FIXTURE_TIMESTAMP).map(switchedOff), ...renderFixtureNodes()];
await writeFile(
  join(scratchKb, "nodes.jsonl"),
  `${fixtureNodes.map((node) => JSON.stringify(node)).join("\n")}\n`,
);

// The served root registers itself as a location; it does so in a home store
// of its own, removed with the scratch root, never in the person's.
process.env.KB_HOME = join(scratchRoot, "home");
process.env.KB_DATA = join(scratchRoot, "data");

// A spec that asks for it (`HarnessOptions.example`) sees the example
// repository extension, trusted in this scratch home's trust store.
if (process.argv.includes(EXAMPLE_ARG)) await writeTrustedExample(scratchRoot);

// Per-spec port: a spec that writes must not share a store with one that
// counts (see harness-server.ts).
const port = process.argv[2] ?? "4323";
/** How the store is served, and how serving it stops. */
const serve = async (): Promise<() => Promise<void>> => {
  if (process.argv.includes(HOSTED_ARG)) {
    // The checkout's own `kb ui`, which composes the families it hosts
    // (`cli/src/host-plugins.ts`) as it does for a person. It serves the
    // suite's build (`KB_UI_DIST`, as every spec does), marked as built from
    // the source as it is, so it does not build its own over it.
    const dist = process.env["KB_UI_DIST"];
    if (dist !== undefined) await Effect.runPromise(markUiBuilt(dist));
    const kb = join(import.meta.dir, "../../../../../bin/kb");
    const child = Bun.spawn([kb, "--root", scratchRoot, "ui", "--port", port, "--no-open"], {
      stdout: "inherit",
      stderr: "inherit",
      // The scratch home and data set above, which a spawn does not pass on unasked.
      env: { ...process.env },
    });
    console.log(`render harness UI (kb ui): port ${port} (scratch root: ${scratchRoot})`);
    return async () => {
      child.kill();
      await child.exited;
    };
  }
  const server = await Effect.runPromise(
    startUi({ root: scratchRoot, port: Number(port), openBrowser: false }),
  );
  console.log(`render harness UI: ${server.url} (scratch root: ${scratchRoot})`);
  return () => Effect.runPromise(server.stop);
};
const stopServing = await serve();

const stop = async () => {
  await stopServing();
  await rm(scratchRoot, { recursive: true, force: true });
  process.exit(0);
};
process.once("SIGINT", () => void stop());
process.once("SIGTERM", () => void stop());
await new Promise(() => {});
