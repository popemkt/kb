/** Shared policy for reviewed measurement budgets. */
import { execFileSync } from "node:child_process";
import { WORKSPACE_ROOT, gitEnv } from "./workspace.ts";

function runBudgetGit(args: string[]): string {
  return execFileSync("git", args, {
    cwd: WORKSPACE_ROOT,
    encoding: "utf8",
    env: gitEnv(),
    stdio: ["ignore", "pipe", "ignore"],
  });
}

/** Read the committed budget at the existing ratchet fork point. */
export function budgetsAtBase(
  rev: string,
  path: string,
  legacy: Record<string, number> = {},
): Record<string, MeasureBudget> {
  try {
    runBudgetGit(["cat-file", "-e", `${rev}:${path}`]);
  } catch {
    return Object.fromEntries(Object.entries(legacy).map(([name, limit]) => [name, { limit }]));
  }
  // The original surface budget format called its ceiling `width`.
  const entries = JSON.parse(runBudgetGit(["show", `${rev}:${path}`])) as Record<
    string,
    { limit?: number; width?: number; reason?: string }
  >;
  return Object.fromEntries(
    Object.entries(entries).map(([name, value]) => {
      const limit = value.limit ?? value.width;
      if (limit === undefined) throw new Error(`${path}: ${name} has no budget limit`);
      return [name, { limit, ...(value.reason === undefined ? {} : { reason: value.reason }) }];
    }),
  );
}

export interface MeasureBudget {
  limit: number;
  reason?: string;
}

/** Measured sizes may grow within a reviewed ceiling; increases need a changed reason. */
export function budgetProblems(
  measured: Record<string, number>,
  budgets: Readonly<Record<string, MeasureBudget>>,
  previous: Readonly<Record<string, MeasureBudget>>,
  defaultLimit: number,
  lane: string,
): string[] {
  const problems: string[] = [];
  for (const [name, width] of Object.entries(measured)) {
    if (width > (budgets[name]?.limit ?? defaultLimit)) {
      problems.push(`${lane} ${name} exceeds its budget`);
    }
  }
  for (const name of new Set([...Object.keys(measured), ...Object.keys(budgets)])) {
    const budget = budgets[name];
    const before = previous[name];
    const reason = budget?.reason?.trim() ?? "";
    if (
      (budget?.limit ?? defaultLimit) > (before?.limit ?? defaultLimit) &&
      (reason === "" || reason === before?.reason?.trim())
    ) {
      problems.push(`${lane} ${name} budget rise needs a new or updated reason`);
    }
  }
  return problems;
}
