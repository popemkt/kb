// Deliberately .e2e.ts: Bun's recursive unit-test discovery must not load it.
//
// The page's datalog runs in a worker under a budget (DESIGN-UI.md → Replica
// queries). Only a real browser has a real worker to stop, so only here can
// a run that never ends be shown to stop, the page be shown to stay
// responsive meanwhile, and the next query be shown to get its answer.
import type { Page } from "playwright/test";
import { expect, test } from "./harness-test.ts";

const ROOT = "render.fixture.root";
const SLOW = "qb.query.slow";
const FAST = "qb.query.fast";

/**
 * Exponential backtracking: `^(a+)+$` against a run of `a`s that ends in
 * something else. Each `a` doubles the work and none of it allocates, so the
 * run outlasts any budget without taking the worker's memory with it.
 */
const SLOW_EDN =
  '[:find ?id :where [?n :node/text ?t] [(re-pattern "^(a+)+$") ?re] [(re-find ?re ?t)] [?n :node/id ?id]]';
const FAST_EDN = `[:find ?id :where [?n :node/id ?id] [(= ?id "${ROOT}")]]`;

/** The longest a frame takes over `ms`, sampled on the main thread. */
function longestFrame(page: Page, ms: number): Promise<number> {
  return page.evaluate(
    (span) =>
      new Promise<number>((resolve) => {
        let last = performance.now();
        let longest = 0;
        const end = last + span;
        const tick = (now: number) => {
          longest = Math.max(longest, now - last);
          last = now;
          if (now < end) requestAnimationFrame(tick);
          else resolve(longest);
        };
        requestAnimationFrame(tick);
      }),
    ms,
  );
}

test("a query that overruns its budget is stopped, the page stays responsive, and the next query answers", async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const action = async (id: string, input: Record<string, unknown>) => {
    const response = await request.post("/api/action", { data: { id, input } });
    const receipt = await response.json();
    expect(receipt.status, JSON.stringify(receipt)).toBe("succeeded");
  };
  await action("node.add", { id: "qb.backtrack", text: `${"a".repeat(40)}!`, parent: ROOT });
  for (const [id, edn] of [
    [FAST, FAST_EDN],
    [SLOW, SLOW_EDN],
  ]) {
    await action("node.add", {
      id,
      text: id === SLOW ? "Slow query" : "Fast query",
      position: 0,
      props: [{ field: "sys.f.query", value: { t: "str", v: edn } }],
    });
  }

  await page.goto("/");
  const slow = page.locator(`[data-node-id="${SLOW}"]`).first();
  await expect(slow).toBeVisible();
  await slow.getByRole("button", { name: "Expand results" }).first().click();
  await expect(slow).toContainText("Loading results…");

  // While the worker is busy, the main thread keeps drawing frames.
  expect(await longestFrame(page, 1500)).toBeLessThan(250);

  await expect(slow).toContainText("took longer than 3 s to run, so it was stopped", {
    timeout: 10_000,
  });

  // The engine was replaced: a query asked after the stop gets its rows.
  const fast = page.locator(`[data-node-id="${FAST}"]`).first();
  await fast.getByRole("button", { name: "Expand results" }).first().click();
  await expect(fast.locator(`[data-node-id="${ROOT}"]`).first()).toBeVisible();
  expect(errors).toEqual([]);
});
