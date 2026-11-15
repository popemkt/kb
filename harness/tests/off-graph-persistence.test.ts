/**
 * State kept outside the store is named, file by file (AGENTS.md → Rule 1,
 * "State kept outside the store is off-graph"; where it counts is `OFF_GRAPH`
 * in `constraints.ts`). Every file that keeps some carries one marker with
 * its reason, and its count of uses, kept in the ledger's `off-graph` lane,
 * cannot rise against the base.
 *
 * Red case: a new `localStorage.setItem` in a UI store fails here, as a
 * file that appeared without a marker, or as a count that rose in one that
 * has one.
 */
import { readFileSync } from "node:fs";
import { afterAll, expect, test } from "bun:test";
import { collectOffGraph, markerProblems, offGraphCounts } from "../src/off-graph.ts";
import { ratchetMismatches, ratchetRises } from "../src/ratchet.ts";
import { BASELINE_PATH, baselineAtRatchetBase, type BaselineLanes } from "../src/snapshot.ts";
import {
  fixtureWorkspace,
  removeFixtureWorkspaces,
  type FixturePackage,
} from "./fixture-workspace.ts";

afterAll(removeFixtureWorkspaces);

const pkg = (dir: string, files: Record<string, string>): FixturePackage => ({
  dir,
  name: `@kb/${dir.slice(dir.indexOf("/") + 1)}`,
  scope: "browser",
  files,
});

const STORE = 'export const save = (v: string) => localStorage.setItem("k", v);\n';

test("browser storage anywhere is a use; a name in a string or a comment is not", () => {
  const files = collectOffGraph(
    fixtureWorkspace([
      pkg("app/ui", {
        "src/stores/a.store.ts": STORE,
        "src/note.ts": '// localStorage is not used here\nexport const s = "sessionStorage";\n',
      }),
      pkg("infrastructure/worker", {
        "src/index.ts": "export const db = () => indexedDB.open('x');\n",
      }),
    ]),
  );
  expect(offGraphCounts(files)).toEqual({
    "app/ui/src/stores/a.store.ts": 1,
    "infrastructure/worker/src/index.ts": 1,
  });
});

test("a file write is a use in a feature layer, and the persistence layer's own in infrastructure and app", () => {
  const write =
    'export const w = (fs: any) => { fs.writeFileString("a", "b"); Bun.write("c", "d"); };\n';
  const files = collectOffGraph(
    fixtureWorkspace([
      pkg("extension/docs", { "src/index.ts": write }),
      pkg("domain/model", { "src/index.ts": write }),
      pkg("infrastructure/store", { "src/index.ts": write }),
      pkg("app/server", { "src/index.ts": write }),
    ]),
  );
  expect(offGraphCounts(files)).toEqual({
    "domain/model/src/index.ts": 2,
    "extension/docs/src/index.ts": 2,
  });
});

test("tests are not production code", () => {
  const files = collectOffGraph(
    fixtureWorkspace([pkg("app/ui", { "src/a.test.ts": STORE, "tests/b.ts": STORE })]),
  );
  expect(files.size).toBe(0);
});

test("each file with a use carries one marker that says why, and a marker needs a use", () => {
  const files = collectOffGraph(
    fixtureWorkspace([
      pkg("app/ui", {
        "src/bare.ts": STORE,
        "src/device.ts": `// off-graph: device-local — the pane layout is this screen's\n${STORE}`,
        "src/gap.ts": `// off-graph: GAP [[01ABC]]\n${STORE}`,
        "src/fine.ts": `// off-graph: fine — read once and removed\n${STORE}`,
        "src/no-reason.ts": `// off-graph: device-local\n${STORE}`,
        "src/two.ts": `// off-graph: fine — a\n// off-graph: fine — b\n${STORE}`,
        "src/stale.ts": "// off-graph: fine — it used to keep a key\nexport const x = 1;\n",
      }),
    ]),
  );
  expect(markerProblems(files).map((problem) => problem.split(" ")[1])).toEqual([
    "app/ui/src/bare.ts",
    "app/ui/src/no-reason.ts",
    "app/ui/src/stale.ts",
    "app/ui/src/two.ts",
  ]);
});

test("every off-graph file names its reason, and the lane matches the ledger and cannot grow against its base", () => {
  const files = collectOffGraph();
  const problems = markerProblems(files);
  const current = offGraphCounts(files);
  const ledger = (JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as BaselineLanes).lanes;
  problems.push(...ratchetMismatches(ledger["off-graph"], current, "off-graph"));
  const base = baselineAtRatchetBase();
  expect(base.ok, base.ok ? "" : base.reason).toBe(true);
  if (!base.ok) return;
  const previous = base.lanes["off-graph"];
  if (previous !== undefined) problems.push(...ratchetRises(previous, current, "off-graph"));
  expect(problems, problems.join("\n")).toEqual([]);
});
