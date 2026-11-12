import { expect, test } from "bun:test";
import { lazyDepths, lazyFenceBreaches } from "../src/import-closure.ts";
import { readFileSync } from "node:fs";
import { budgetProblems, budgetsAtBase } from "../src/budgets.ts";
import { CLI_CLOSURE_BUDGETS, LAZY_FENCES } from "../src/constraints.ts";
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

test("CLI measurements match the ledger, fit budgets and retain the lazy fence", () => {
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
    if (lane === "lazy-fence" && previous !== undefined)
      problems.push(...ratchetRises(previous, current[lane], lane));
  }
  problems.push(
    ...budgetProblems(
      current["cli-closure"],
      CLI_CLOSURE_BUDGETS,
      budgetsAtBase(base.rev, "harness/cli-closure-budgets.json", base.lanes["cli-closure"]),
      0,
      "cli-closure",
    ),
  );
  expect(problems, problems.join("\n")).toEqual([]);
}, 30000);

test("a CLI closure budget increase needs a changed reason; forbidden imports remain debt", () => {
  const previous = { modules: { limit: 1107 } };
  expect(
    budgetProblems(
      { modules: 1108 },
      { modules: { limit: 1108, reason: "seed builders split from seed application" } },
      previous,
      0,
      "cli-closure",
    ),
  ).toEqual([]);
  expect(
    budgetProblems({ modules: 1108 }, { modules: { limit: 1108 } }, previous, 0, "cli-closure"),
  ).toHaveLength(1);
  expect(ratchetRises({}, { "file imports forbidden engine": 1 }, "lazy-fence")).toHaveLength(1);
});
