import { afterAll, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { cohesionGroups, collectCohesion } from "../src/cohesion.ts";
import type { ConsumedSymbol } from "../src/symbol-consumers.ts";
import { BASELINE_PATH, baselineAtRatchetBase, type BaselineLanes } from "../src/snapshot.ts";
import { ratchetMismatches, ratchetRises } from "../src/ratchet.ts";
import { fixtureWorkspace, removeFixtureWorkspaces } from "./fixture-workspace.ts";

afterAll(removeFixtureWorkspaces);
const symbol = (name: string, importers: string[]): ConsumedSymbol => ({
  file: "core.ts",
  owner: "@kb/core",
  name,
  importers: new Set(importers),
});

test("overlapping importers connect groups transitively; single-importer satellites do not count", () => {
  expect(
    cohesionGroups([
      symbol("a", ["a", "b"]),
      symbol("b", ["b", "c"]),
      symbol("c", ["d", "e"]),
      symbol("satellite", ["z"]),
    ]),
  ).toBe(2);
  expect(
    cohesionGroups([
      symbol("a", ["a", "b"]),
      symbol("bridge", ["b", "c"]),
      symbol("c", ["c", "d"]),
    ]),
  ).toBe(1);
});

test("large files require the five-percent importer floor, rounded up", () => {
  const main = symbol(
    "main",
    Array.from({ length: 100 }, (_, i) => `main${i}`),
  );
  expect(cohesionGroups([main, symbol("small", ["a", "b", "c", "d"])])).toBe(1);
  expect(cohesionGroups([main, symbol("separate", ["a", "b", "c", "d", "e", "f"])])).toBe(2);
});

function measure(lines: number) {
  const root = fixtureWorkspace([
    {
      dir: "domain/core",
      name: "@kb/core",
      scope: "shared",
      files: {
        "src/index.ts": 'export {x,y} from "./values.ts";',
        "src/values.ts":
          "export const x=1;\nexport const y=2;\n" + "// padding\n".repeat(lines - 2),
      },
    },
    {
      dir: "application/users",
      name: "@kb/users",
      scope: "shared",
      files: {
        "src/index.ts": "",
        "src/a.ts": 'import {x} from "@kb/core";',
        "src/b.ts": 'import {x} from "@kb/core";',
        "src/c.ts": 'import {y} from "@kb/core";',
        "src/d.ts": 'import {y} from "@kb/core";',
      },
    },
  ]);
  return collectCohesion(root);
}

test("the line threshold excludes 400 physical lines and admits 401, with a trailing newline", () => {
  expect(measure(400)).toEqual({});
  expect(measure(401)).toEqual({ "domain/core/src/values.ts": 1 });
});

test("the cohesion ledger equals the calibrated sensor and cannot rise", () => {
  const ledger = (JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as BaselineLanes).lanes;
  const current = collectCohesion();
  const base = baselineAtRatchetBase();
  expect(base.ok, base.ok ? "" : base.reason).toBe(true);
  if (!base.ok) return;
  const problems = ratchetMismatches(ledger.cohesion, current, "cohesion");
  const previous = base.lanes.cohesion;
  if (previous !== undefined) problems.push(...ratchetRises(previous, current, "cohesion"));
  expect(problems, problems.join("\n")).toEqual([]);
});
