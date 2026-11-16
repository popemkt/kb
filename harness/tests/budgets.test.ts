import { expect, test } from "bun:test";
import {
  budgetExceeded,
  budgetLimit,
  currentLedger,
  filesAt,
  readLedger,
  unledgeredRises,
  type BudgetLedger,
  type LedgerFiles,
} from "../src/budgets.ts";
import { baselineAtRatchetBase } from "../src/snapshot.ts";

/** A ledger held in memory: workspace-relative path to text. */
function memoryFiles(files: Record<string, unknown>): LedgerFiles {
  return {
    names: (dir) =>
      Object.keys(files)
        .filter((path) => path.startsWith(`${dir}/`) && !path.slice(dir.length + 1).includes("/"))
        .map((path) => path.slice(dir.length + 1)),
    text: (path) => (path in files ? JSON.stringify(files[path]) : undefined),
  };
}

const BASE = {
  "harness/budgets/surface.json": { "@kb/model": { limit: 10, reason: "its names" } },
  "harness/budgets/cli-closure.json": { bytes: { limit: 100 } },
  "harness/budgets/page-eager.json": { bytes: { limit: 1000 } },
};

function ledger(files: Record<string, unknown>): BudgetLedger {
  const read = readLedger(memoryFiles({ ...BASE, ...files }));
  if (read === undefined) throw new Error("fixture lacks a base");
  return read;
}

const raise = (budget: string, key: string, delta: number, reason = "a change") => ({
  reason,
  raise: { [budget]: { [key]: delta } },
});

test("the ledger reads, and every rise since the fork point is a new change file", () => {
  const now = currentLedger();
  expect(now.problems).toEqual([]);
  const base = baselineAtRatchetBase();
  expect(base.ok, base.ok ? "" : base.reason).toBe(true);
  if (!base.ok) return;
  // Only the commit that introduces the ledger has a base without one.
  const before = readLedger(filesAt(base.rev));
  if (before !== undefined) expect(unledgeredRises(now, before)).toEqual([]);
});

test("a limit is the base, or the default, plus every change's delta", () => {
  const two = ledger({
    "harness/budgets/changes/a.json": raise("surface", "@kb/model", 2),
    "harness/budgets/changes/b.json": raise("surface", "@kb/model", 3),
    "harness/budgets/changes/c.json": raise("surface", "@kb/new", 5),
  });
  expect(budgetLimit(two, "surface", "@kb/model")).toBe(15);
  expect(budgetLimit(two, "surface", "@kb/new")).toBe(65);
  expect(budgetLimit(two, "surface", "@kb/other")).toBe(60);
  expect(budgetExceeded({ "@kb/model": 15 }, two, "surface")).toEqual([]);
  expect(budgetExceeded({ "@kb/model": 16 }, two, "surface")).toHaveLength(1);
});

test("two changes that each raise one limit compose by addition", () => {
  const a = { "harness/budgets/changes/2026-11-16-a.json": raise("page-eager", "bytes", 40) };
  const b = { "harness/budgets/changes/2026-11-16-b.json": raise("page-eager", "bytes", 2) };
  const base = ledger({});
  expect(unledgeredRises(ledger(a), base)).toEqual([]);
  expect(unledgeredRises(ledger(b), base)).toEqual([]);
  const merged = ledger({ ...a, ...b });
  expect(budgetLimit(merged, "page-eager", "bytes")).toBe(1042);
  expect(unledgeredRises(merged, ledger(a))).toEqual([]);
});

test("a ceiling rises only through a new change file", () => {
  const earlier = { "harness/budgets/changes/old.json": raise("cli-closure", "bytes", 5) };
  const base = ledger(earlier);
  // Editing the base.
  expect(
    unledgeredRises(
      ledger({ ...earlier, "harness/budgets/cli-closure.json": { bytes: { limit: 101 } } }),
      base,
    ),
  ).toHaveLength(1);
  // Editing an earlier change.
  expect(
    unledgeredRises(
      ledger({ "harness/budgets/changes/old.json": raise("cli-closure", "bytes", 6) }),
      base,
    ),
  ).toHaveLength(1);
  // Removing an entry, so that a higher default applies.
  expect(
    unledgeredRises(
      ledger({ ...earlier, "harness/budgets/surface.json": {} }),
      ledger({ ...earlier }),
    ),
  ).toEqual([
    "surface @kb/model rose from 10 to 60 without a new change file under harness/budgets/changes",
  ]);
  // Folding a change into the base keeps every limit.
  expect(
    unledgeredRises(
      ledger({ "harness/budgets/cli-closure.json": { bytes: { limit: 105 } } }),
      base,
    ),
  ).toEqual([]);
  // Lowering needs nothing.
  expect(unledgeredRises(ledger({}), base)).toEqual([]);
});

test("a change that cannot be read is named and adds nothing", () => {
  const bad = ledger({
    "harness/budgets/changes/no-reason.json": raise("surface", "@kb/model", 1, " "),
    "harness/budgets/changes/typo.json": raise("surfaces", "@kb/model", 1),
    "harness/budgets/changes/zero.json": raise("surface", "@kb/model", 0),
    "harness/budgets/changes/half.json": raise("surface", "@kb/model", 0.5),
    "harness/budgets/changes/empty.json": { reason: "nothing", raise: {} },
  });
  expect(bad.problems).toHaveLength(5);
  expect(bad.changes).toEqual({});
  expect(budgetLimit(bad, "surface", "@kb/model")).toBe(10);
});
