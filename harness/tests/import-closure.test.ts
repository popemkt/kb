import { expect, test } from "bun:test";
import { lazyDepths, lazyFenceBreaches } from "../src/import-closure.ts";
import { readFileSync } from "node:fs";
import { LAZY_FENCES } from "../src/constraints.ts";
import { ratchetMismatches, ratchetRises } from "../src/ratchet.ts";
import { BASELINE_PATH, baselineAtRatchetBase, type BaselineLanes } from "../src/snapshot.ts";
import { collectCliFence, collectStaticClosure, staticOutputClosure } from "../src/cli-closure.ts";

const fence = {
  entry: "entry.ts",
  forbidden: /^host(?:\/|$)/,
  depth: 1,
  boundary: "dependency",
} as const;

test("dependency fences accept dynamic loads, ignore erased imports and reject an eager bypass", () => {
  const sites = [
    { file: "entry.ts", specifier: "./a", kind: "eager", target: "a.ts" },
    { file: "a.ts", specifier: "host", kind: "lazy", target: undefined },
    { file: "entry.ts", specifier: "host/types", kind: "type", target: undefined },
  ] as const;
  expect(lazyFenceBreaches(sites, fence)).toEqual([]);
  expect(
    lazyFenceBreaches(
      [...sites, { file: "a.ts", specifier: "host", kind: "eager", target: undefined }],
      fence,
    ),
  ).toEqual(["entry.ts -> a.ts -> host"]);
  expect(
    lazyDepths(
      [...sites, { file: "a.ts", specifier: "./entry", kind: "eager", target: "entry.ts" }],
      "entry.ts",
    ).size,
  ).toBe(2);
});

test("a relative import cannot bypass a forbidden target", () => {
  expect(
    lazyFenceBreaches(
      [{ file: "entry.ts", specifier: "../host", kind: "eager", target: "host/index.ts" }],
      fence,
    ),
  ).toEqual(["entry.ts -> ../host"]);
});

test("static emitted closure follows shared chunks once and excludes dynamic chunks", () => {
  const outputs = {
    "./entry.js": {
      entryPoint: "entry.ts",
      bytes: 10,
      inputs: { a: {} },
      imports: [
        { path: "./shared.js", kind: "import-statement" },
        { path: "./lazy.js", kind: "dynamic-import" },
      ],
    },
    "./shared.js": {
      bytes: 20,
      inputs: { b: {}, a: {} },
      imports: [{ path: "./entry.js", kind: "import-statement" }],
    },
    "./lazy.js": { bytes: 50, inputs: { c: {} }, imports: [] },
  };
  expect(staticOutputClosure(outputs, "entry.ts")).toEqual({ bytes: 30, modules: 2 });
  expect(() => staticOutputClosure({}, "missing.ts")).toThrow("no entry");
});

test("CLI fence and static closure match the ledger and never rise", () => {
  const ledger = (JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as BaselineLanes).lanes;
  const base = baselineAtRatchetBase();
  expect(base.ok, base.ok ? "" : base.reason).toBe(true);
  if (!base.ok) return;
  const current = {
    "lazy-fence": collectCliFence(),
    "cli-closure": collectStaticClosure(LAZY_FENCES.cli.entry),
  };
  const problems: string[] = [];
  for (const lane of ["lazy-fence", "cli-closure"] as const) {
    problems.push(...ratchetMismatches(ledger[lane], current[lane], lane));
    const previous = base.lanes[lane];
    // Only the introducing commit may have a base without these lanes.
    if (previous !== undefined) problems.push(...ratchetRises(previous, current[lane], lane));
  }
  expect(problems, problems.join("\n")).toEqual([]);
}, 30000);
