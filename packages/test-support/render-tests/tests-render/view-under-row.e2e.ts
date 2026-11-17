// Deliberately .e2e.ts: Bun's recursive unit-test discovery must not load it.
//
// A frame view under an outline row sits in the row's child column
// (DESIGN-UI.md → Frame views, "A view under a row"): on a centered page a
// table, a board or a calendar takes the room to the right, but its left
// edge stays on its own box, so the parent's guide line runs beside it and
// never through its card or its rows. Every kind lines up at the one edge a
// cards view (which never breaks out) starts at.
import type { APIRequestContext, Locator } from "playwright/test";
import { expect, settledBox, test } from "./harness-test.ts";

const ROOT = "render.fixture.root";
const PARENT = "vur.parent";
const ref = (v: string) => ({ t: "ref", v });

async function action(request: APIRequestContext, id: string, input: Record<string, unknown>) {
  const response = await request.post("/api/action", { data: { id, input } });
  expect((await response.json()).status).toBe("succeeded");
}

/**
 * Open the row `block` draws, by its own bullet, unless it is open already: a
 * row with children opens collapsed unless the reader opened it, so the test
 * never relies on how a page first draws its rows.
 */
async function openRow(block: Locator) {
  const row = block.locator("[data-node-row]").first();
  const bullet = row.getByRole("button", { name: /^(Expand|Collapse)/ }).first();
  await expect(bullet).toBeVisible();
  if ((await bullet.getAttribute("aria-label"))?.startsWith("Expand") === true)
    await bullet.click();
  await expect(bullet).toHaveAttribute("aria-label", /^Collapse/);
}

/** Each kind: its view option, and the element the view draws its frame with. */
const KINDS = [
  ["table", "sys.view.outline.table", "[data-table-view]"],
  ["board", "sys.view.outline.board", '[data-board-cards-view][data-view-mode="board"]'],
  ["calendar", "sys.view.collections.calendar", "[data-calendar-view]"],
  ["cards", "sys.view.outline.cards", '[data-board-cards-view][data-view-mode="cards"]'],
] as const;

test("a view under a row keeps to the child column, beside its parent's guide line", async ({
  page,
  request,
}) => {
  await page.clock.setFixedTime(new Date("2026-11-14T10:00:00"));
  await action(request, "node.add", { id: PARENT, text: "Views here", parent: ROOT, position: 0 });
  for (const [kind, option] of KINDS) {
    const host = `vur.${kind}`;
    await action(request, "node.add", {
      id: `${host}.view`,
      text: "",
      parent: "views",
      props: [{ field: "sys.f.view", value: ref(option) }],
    });
    await action(request, "node.add", {
      id: host,
      text: `As ${kind}`,
      parent: PARENT,
      props: [{ field: "sys.f.views", value: ref(`${host}.view`) }],
    });
    for (const n of [1, 2])
      await action(request, "node.add", { id: `${host}.${n}`, text: `${kind} ${n}`, parent: host });
  }

  await page.goto(`/node/${PARENT}`);
  const lefts: number[] = [];
  for (const [kind, , selector] of KINDS) {
    const block = page.locator(`[data-node-block][data-node-id="vur.${kind}"]`).first();
    const view = block.locator(`.children-container ${selector}`).first();
    await openRow(block);
    await expect(view).toBeVisible();
    const guide = await settledBox(
      block.locator(".children-container > div.absolute > div").first(),
    );
    const box = await settledBox(view);
    // The guide line runs beside the view, not through it.
    expect(box.x, `${kind}'s left edge`).toBeGreaterThan(guide.x + guide.width);
    lefts.push(box.x);
  }
  // A table, a board and a calendar start where a cards view does: the child's box.
  for (const left of lefts) expect(Math.abs(left - (lefts.at(-1) ?? 0))).toBeLessThan(1);
});
