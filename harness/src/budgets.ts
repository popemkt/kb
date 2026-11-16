/**
 * Budgets: reviewed ceilings on sizes that may grow, each a base plus the
 * changes that raised it (DESIGN.md → Budgets). This is the one reader of
 * `harness/budgets/`; a measurement outside the harness asks it through
 * `bun harness/src/budgets.ts limit <budget> <key>`.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { BUDGETS, type BudgetName } from "./constraints.ts";
import { WORKSPACE_ROOT, gitEnv } from "./workspace.ts";

/** Workspace-relative: the base of each budget, and one file per change under `changes/`. */
const BUDGETS_DIR = "harness/budgets";
const CHANGES_DIR = `${BUDGETS_DIR}/changes`;

interface BudgetBaseEntry {
  limit: number;
  reason?: string;
}

/** One change: why, where it was reviewed, and what it adds per budget and key. */
interface BudgetChange {
  reason: string;
  pr?: string;
  raise: Partial<Record<BudgetName, Record<string, number>>>;
}

export interface BudgetLedger {
  base: Record<BudgetName, Record<string, BudgetBaseEntry>>;
  /** Keyed by file name. */
  changes: Record<string, BudgetChange>;
}

/** Where a ledger is read from: the working tree, or a commit. */
export interface LedgerFiles {
  /** File names (not paths) of the `.json` files directly in `dir`. */
  names(dir: string): string[];
  text(path: string): string | undefined;
}

const worktreeFiles: LedgerFiles = {
  names: (dir) => {
    const abs = join(WORKSPACE_ROOT, dir);
    return existsSync(abs) ? readdirSync(abs).filter((name) => name.endsWith(".json")) : [];
  },
  text: (path) => {
    const abs = join(WORKSPACE_ROOT, path);
    return existsSync(abs) ? readFileSync(abs, "utf8") : undefined;
  },
};

function git(args: string[]): string | undefined {
  try {
    return execFileSync("git", args, {
      cwd: WORKSPACE_ROOT,
      encoding: "utf8",
      env: gitEnv(),
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return undefined;
  }
}

export function filesAt(rev: string): LedgerFiles {
  return {
    names: (dir) =>
      (git(["ls-tree", "--name-only", `${rev}:${dir}`]) ?? "")
        .split("\n")
        .filter((name) => name.endsWith(".json")),
    text: (path) => git(["show", `${rev}:${path}`]),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBudgetName(name: string): name is BudgetName {
  return Object.hasOwn(BUDGETS, name);
}

/** A file under harness/budgets/ that does not decode; every reader of the ledger fails on it. */
export class BudgetLedgerError extends Error {
  readonly problems: readonly string[];
  constructor(problems: readonly string[]) {
    super(`the budget ledger does not decode:\n${problems.join("\n")}`);
    this.problems = problems;
  }
}

function parseObject(where: string, text: string): Record<string, unknown> | string {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return `${where} is not JSON`;
  }
  return isRecord(value) ? value : `${where} is not an object`;
}

function decodeBase(where: string, text: string): Record<string, BudgetBaseEntry> | string {
  const value = parseObject(where, text);
  if (typeof value === "string") return value;
  const base: Record<string, BudgetBaseEntry> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!isRecord(entry)) return `${where}: ${key} is not an object`;
    const { limit, reason, ...rest } = entry;
    if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 0) {
      return `${where}: ${key}.limit is not a nonnegative integer`;
    }
    if (reason !== undefined && typeof reason !== "string") {
      return `${where}: ${key}.reason is not a string`;
    }
    const unknown = Object.keys(rest);
    if (unknown.length > 0) return `${where}: ${key} has unknown fields ${unknown.join(", ")}`;
    base[key] = reason === undefined ? { limit } : { limit, reason };
  }
  return base;
}

function decodeChange(where: string, text: string): BudgetChange | string {
  const value = parseObject(where, text);
  if (typeof value === "string") return value;
  const { reason, pr, raise, ...rest } = value;
  if (typeof reason !== "string" || reason.trim() === "") return `${where} needs a reason`;
  if (pr !== undefined && typeof pr !== "string") return `${where}: pr is not a string`;
  if (!isRecord(raise) || Object.keys(raise).length === 0) return `${where} raises nothing`;
  const unknown = Object.keys(rest);
  if (unknown.length > 0) return `${where} has unknown fields ${unknown.join(", ")}`;
  const decoded: BudgetChange["raise"] = {};
  for (const [budget, deltas] of Object.entries(raise)) {
    if (!isBudgetName(budget)) return `${where} names ${budget}, which BUDGETS does not declare`;
    if (!isRecord(deltas)) return `${where}: raise.${budget} is not an object`;
    const keys: Record<string, number> = {};
    for (const [key, delta] of Object.entries(deltas)) {
      if (typeof delta !== "number" || !Number.isInteger(delta) || delta === 0) {
        return `${where}: raise.${budget}.${key} is not a nonzero integer`;
      }
      keys[key] = delta;
    }
    decoded[budget] = keys;
  }
  return { reason, ...(pr === undefined ? {} : { pr }), raise: decoded };
}

/**
 * The ledger as `files` holds it, or `undefined` when it holds no ledger (a
 * base before one). A file that does not decode throws {@link BudgetLedgerError}
 * naming every such file: no reader may skip one, since a dropped base entry
 * falls back to the default and a dropped change could have lowered a limit.
 */
export function readLedger(files: LedgerFiles = worktreeFiles): BudgetLedger | undefined {
  const base = {} as BudgetLedger["base"];
  const problems: string[] = [];
  for (const budget of Object.keys(BUDGETS) as BudgetName[]) {
    const where = `${BUDGETS_DIR}/${budget}.json`;
    const text = files.text(where);
    if (text === undefined) return undefined;
    const entries = decodeBase(where, text);
    if (typeof entries === "string") problems.push(entries);
    else base[budget] = entries;
  }
  const changes: Record<string, BudgetChange> = {};
  for (const name of files.names(CHANGES_DIR)) {
    const where = `${CHANGES_DIR}/${name}`;
    const change = decodeChange(where, files.text(where) ?? "");
    if (typeof change === "string") problems.push(change);
    else changes[name] = change;
  }
  if (problems.length > 0) throw new BudgetLedgerError(problems);
  return { base, changes };
}

/** The ledger in the working tree, which every declared budget's base must be in. */
export function currentLedger(): BudgetLedger {
  const ledger = readLedger();
  if (ledger === undefined) {
    throw new Error(`${BUDGETS_DIR} lacks a base file for a budget BUDGETS declares`);
  }
  return ledger;
}

/** A key's limit: its base limit, or the budget's default, plus every change's delta for it. */
export function budgetLimit(ledger: BudgetLedger, budget: BudgetName, key: string): number {
  let limit = ledger.base[budget][key]?.limit ?? BUDGETS[budget].default;
  for (const change of Object.values(ledger.changes)) limit += change.raise[budget]?.[key] ?? 0;
  return limit;
}

/** Every key the ledger states a limit for in `budget`. */
function ledgerKeys(ledger: BudgetLedger, budget: BudgetName): string[] {
  const keys = new Set(Object.keys(ledger.base[budget]));
  for (const change of Object.values(ledger.changes)) {
    for (const key of Object.keys(change.raise[budget] ?? {})) keys.add(key);
  }
  return [...keys];
}

/** Every measured key over its limit. */
export function budgetExceeded(
  measured: Readonly<Record<string, number>>,
  ledger: BudgetLedger,
  budget: BudgetName,
): string[] {
  const problems: string[] = [];
  for (const [key, size] of Object.entries(measured)) {
    const limit = budgetLimit(ledger, budget, key);
    if (size > limit) {
      problems.push(
        `${budget} ${key} measures ${size}, over its limit of ${limit}; add a change file under ${CHANGES_DIR} (DESIGN.md → Budgets)`,
      );
    }
  }
  return problems.toSorted();
}

/**
 * Every limit higher than at `base` by more than the changes added since:
 * a ceiling rises only through a new change file, never by editing the base,
 * an earlier change, or removing an entry so that a higher default applies.
 */
export function unledgeredRises(ledger: BudgetLedger, base: BudgetLedger): string[] {
  const added = Object.entries(ledger.changes)
    .filter(([name]) => !Object.hasOwn(base.changes, name))
    .map(([, change]) => change);
  const problems: string[] = [];
  for (const budget of Object.keys(BUDGETS) as BudgetName[]) {
    for (const key of new Set([...ledgerKeys(ledger, budget), ...ledgerKeys(base, budget)])) {
      const was = budgetLimit(base, budget, key);
      const allowed = added.reduce((sum, change) => sum + (change.raise[budget]?.[key] ?? 0), was);
      const now = budgetLimit(ledger, budget, key);
      if (now > allowed) {
        problems.push(
          `${budget} ${key} rose from ${was} to ${now} without a new change file under ${CHANGES_DIR}`,
        );
      }
    }
  }
  return problems.toSorted();
}

if (import.meta.main) {
  const [verb, budget, key] = process.argv.slice(2);
  if (verb !== "limit" || budget === undefined || key === undefined || !isBudgetName(budget)) {
    console.error(
      `usage: bun harness/src/budgets.ts limit <${Object.keys(BUDGETS).join("|")}> <key>`,
    );
    process.exit(2);
  }
  console.log(budgetLimit(currentLedger(), budget, key));
}
