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

test("module lanes equal reality and cannot grow against their first committed baseline", () => {
  const measured = collectModuleMeasures();
  const ledger = (JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as BaselineLanes).lanes;
  const base = baselineAtRatchetBase();
  expect(base.ok, base.ok ? "" : base.reason).toBe(true);
  if (!base.ok) return;
  const problems: string[] = [];
  for (const lane of ["surface", "family-names"] as const) {
    problems.push(...ratchetMismatches(ledger[lane], measured[lane], lane));
    // The parent of the introducing commit has no module lanes. Once present,
    // every subsequent change is checked against that committed measurement.
    const previous = base.lanes[lane];
    if (previous !== undefined) {
      const ceilings =
        lane === "surface"
          ? Object.fromEntries(
              Object.keys(measured.surface).map((name) => [
                name,
                previous[name] ?? NEW_SURFACE_BUDGET,
              ]),
            )
          : previous;
      problems.push(...ratchetRises(ceilings, measured[lane], lane));
    }
  }
  expect(SURFACE_BUDGETS).toEqual(measured.surface);
  expect(problems, problems.join("\n")).toEqual([]);
});
