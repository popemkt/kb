import { budgetProblems, budgetsAtBase } from "../src/budgets.ts";
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { CORE_NAME_LAYERS, NEW_SURFACE_BUDGET, SURFACE_BUDGETS } from "../src/constraints.ts";
import { collectModuleMeasures, exportedNames, familyNameHits } from "../src/module-measures.ts";
import { ratchetMismatches, ratchetRises } from "../src/ratchet.ts";
import { BASELINE_PATH, baselineAtRatchetBase, type BaselineLanes } from "../src/snapshot.ts";

test("surface names include aliases, types and namespaces without double counting", () => {
  expect(
    exportedNames(
      "x.ts",
      'export { A as B } from "./a"; export type { T } from "./t"; export * as ns from "./ns";',
    ),
  ).toEqual(["B", "T", "ns"]);
  expect(() => exportedNames("x.ts", 'export * from "./a"')).toThrow("unnamed star");
});

test("family names are exact ids or dotted members, with comments and substrings ignored", () => {
  expect(
    familyNameHits(
      "x.ts",
      '// canvas\nconst canvas = "canvas.view"; const canvasLike = "mycanvas";',
      ["canvas"],
    ),
  ).toBe(2);
  expect(familyNameHits("x.ts", "const canvas = 1; const obj = {canvas};", ["canvas"])).toBe(2);
  expect(CORE_NAME_LAYERS).toEqual(["domain", "kit", "contract"]);
});

test("keyboard code properties are not family references", () => {
  expect(
    familyNameHits(
      "x.ts",
      `
    function chord(event: KeyboardEvent) { return event.code + event?.code; }
  `,
      ["code", "graph"],
    ),
  ).toBe(0);
  expect(
    familyNameHits(
      "x.ts",
      `
    import * as graph from "@kb/graph";
    graph.render();
    const event = keyboardEvent; event.code;
  `,
      ["code", "graph"],
    ),
  ).toBe(2);
});

for (const [position, source] of Object.entries({
  "property signature": "interface Event { code: string }",
  "property declaration": "class Event { code = 1 }",
  "Exclude keyof key": 'type Key = Exclude<keyof Event, "code">',
  "Pick key": 'type Key = Pick<Event, "code">',
  "Omit key": 'type Key = Omit<Event, "code">',
  "indexed access key": 'type Key = Event["code"]',
})) {
  test(`${position} is vocabulary rather than a family reference`, () => {
    expect(familyNameHits("x.ts", source, ["code"])).toBe(0);
  });
}

test("a family's id as an object key counts, a map keyed by a family included", () => {
  const families = ["code", "canvas"];
  expect(familyNameHits("x.ts", "const icons = { code: icon };", families)).toBe(1);
  expect(
    familyNameHits("x.ts", "const icons: Record<string, Icon> = { code: a, canvas: b };", families),
  ).toBe(2);
});

test("object keys and shorthand preserve family vocabulary", () => {
  expect(
    familyNameHits(
      "x.ts",
      'const schema = { canvas: schema }; const icons = { canvas: "icon" }; const event = {code};',
      ["canvas", "code"],
    ),
  ).toBe(3);
});

test("family strings in values and ordinary string types remain counted", () => {
  expect(
    familyNameHits(
      "x.ts",
      'id === "code"; const x = { kind: "code" }; type Kind = "code"; type Other = Exclude<Kind, "code">;',
      ["code"],
    ),
  ).toBe(4);
});

test("module ledger equals reality, surfaces fit budgets, and family debt cannot grow", () => {
  const measured = collectModuleMeasures();
  const ledger = (JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as BaselineLanes).lanes;
  const base = baselineAtRatchetBase();
  expect(base.ok, base.ok ? "" : base.reason).toBe(true);
  if (!base.ok) return;
  const previous = budgetsAtBase(base.rev, "harness/surface-budgets.json", base.lanes.surface);
  const problems = budgetProblems(
    measured.surface,
    SURFACE_BUDGETS,
    previous,
    NEW_SURFACE_BUDGET,
    "surface",
  );
  for (const lane of ["surface", "family-names"] as const) {
    problems.push(...ratchetMismatches(ledger[lane], measured[lane], lane));
    if (lane === "family-names" && base.lanes[lane] !== undefined) {
      problems.push(...ratchetRises(base.lanes[lane], measured[lane], lane));
    }
  }
  expect(problems, problems.join("\n")).toEqual([]);
});

test("surface growth within an explicitly raised budget needs a changed reason", () => {
  const previous = { outline: { limit: 3, reason: "Original interface" } };
  expect(
    budgetProblems(
      { outline: 9 },
      { outline: { limit: 9, reason: "Shared editing definitions consumed by outline-ui" } },
      previous,
      60,
      "surface",
    ),
  ).toEqual([]);
  expect(
    budgetProblems({ outline: 9 }, { outline: { limit: 9 } }, previous, 60, "surface"),
  ).toHaveLength(1);
  expect(
    budgetProblems(
      { outline: 9 },
      { outline: { limit: 9, reason: "Original interface" } },
      previous,
      60,
      "surface",
    ),
  ).toHaveLength(1);
  expect(
    budgetProblems(
      { outline: 10 },
      { outline: { limit: 9, reason: "New consumer" } },
      previous,
      60,
      "surface",
    ),
  ).toHaveLength(1);
});

test("family-name growth remains debt with no exception", () => {
  expect(ratchetRises({ core: 1 }, { core: 2 }, "family-names")).toHaveLength(1);
});

test("deleting a measured budget cannot silently restore the default ceiling", () => {
  expect(
    budgetProblems(
      { example: 9 },
      {},
      { example: { limit: 3, reason: "Original interface" } },
      60,
      "surface",
    ),
  ).toHaveLength(1);
});
