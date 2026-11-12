import { readFileSync } from "node:fs";
import { BASELINE_PATH, baselineAtRatchetBase, type BaselineLanes } from "../src/snapshot.ts";
import { ratchetMismatches, ratchetRises } from "../src/ratchet.ts";
import { afterAll, expect, test } from "bun:test";
import { collectSingleFamily, symbolConsumers } from "../src/symbol-consumers.ts";
import {
  fixtureWorkspace,
  removeFixtureWorkspaces,
  type FixturePackage,
} from "./fixture-workspace.ts";

afterAll(removeFixtureWorkspaces);
const core: FixturePackage = {
  dir: "domain/core",
  name: "@kb/core",
  scope: "shared",
  files: {
    "src/index.ts": 'export { x as publicX } from "./x.ts"; export type { T } from "./x.ts";',
    "src/x.ts": "export const x = 1; export type T = string;",
  },
};
const user = (name: string, source: string, family = "one"): FixturePackage => ({
  dir: `extension/${name}`,
  name: `@kb/${name}`,
  scope: "shared",
  tags: [`family:${family}`],
  files: { "src/index.ts": source },
});

test("barrel aliases and type imports reach the declaring file; tests are not consumers", () => {
  const root = fixtureWorkspace([
    core,
    user("a", 'import { publicX as local } from "@kb/core"; import type { T } from "@kb/core";'),
    {
      ...user("b", ""),
      files: { "src/index.ts": "", "src/x.test.ts": 'import {publicX} from "@kb/core";' },
    },
  ]);
  expect(collectSingleFamily(root)).toEqual({ "domain/core/src/x.ts": 1 });
  const symbols = symbolConsumers(root);
  expect(symbols.find((symbol) => symbol.name === "x")?.importers).toEqual(
    new Set(["extension/a/src/index.ts"]),
  );
  expect(symbols.find((symbol) => symbol.name === "T")?.importers).toEqual(
    new Set(["extension/a/src/index.ts"]),
  );
});

test("another family or an internal production consumer makes a file shared", () => {
  expect(
    collectSingleFamily(
      fixtureWorkspace([
        core,
        user("a", 'import {publicX} from "@kb/core";'),
        user("b", 'import {publicX} from "@kb/core";', "two"),
      ]),
    ),
  ).toEqual({});
  expect(
    collectSingleFamily(
      fixtureWorkspace([
        { ...core, files: { ...core.files, "src/use.ts": 'import {x} from "./x.ts";' } },
        user("a", 'import {publicX} from "@kb/core";'),
      ]),
    ),
  ).toEqual({});
});

test("namespaces and dynamic imports conservatively consume all exposed names", () => {
  for (const source of ['import * as core from "@kb/core";', 'const core = import("@kb/core");']) {
    const root = fixtureWorkspace([core, user("a", source)]);
    const symbols = symbolConsumers(root).filter((symbol) => symbol.owner === "@kb/core");
    expect(symbols.every((symbol) => symbol.importers.has("extension/a/src/index.ts"))).toBe(true);
  }
});

test("an imported local name re-exported by a barrel resolves to its original declaration", () => {
  const root = fixtureWorkspace([
    {
      ...core,
      files: {
        ...core.files,
        "src/index.ts": 'import {x as local} from "./x.ts"; export {local as publicX};',
      },
    },
    user("a", 'import {publicX} from "@kb/core";'),
  ]);
  expect(symbolConsumers(root).find((symbol) => symbol.name === "x")?.importers).toContain(
    "extension/a/src/index.ts",
  );
});

test("single-family lane matches production imports and cannot grow against its base", () => {
  const ledger = (JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as BaselineLanes).lanes;
  const current = collectSingleFamily();
  const base = baselineAtRatchetBase();
  expect(base.ok, base.ok ? "" : base.reason).toBe(true);
  if (!base.ok) return;
  const previous = base.lanes["single-family"];
  const problems = ratchetMismatches(ledger["single-family"], current, "single-family");
  if (previous !== undefined) problems.push(...ratchetRises(previous, current, "single-family"));
  expect(problems, problems.join("\n")).toEqual([]);
});
