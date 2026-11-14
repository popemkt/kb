// Deliberately .e2e.ts: Bun's recursive unit-test discovery must not load it.
//
// A frame shown as a calendar in a real page (DESIGN-UI.md → Calendar): its
// chips are drawn at the routines calendar's density, one line of label type
// each however long the row's text, so a busy day never grows its week. The
// browser's clock is pinned, so the month shown is the same on every run.
import type { APIRequestContext } from "playwright/test";
import { expect, settledBox, test } from "./harness-test.ts";

const ROOT = "render.fixture.root";
const FRAME = "cal.frame";
const ref = (v: string) => ({ t: "ref", v });
const str = (v: string) => ({ t: "str", v });

async function action(request: APIRequestContext, id: string, input: Record<string, unknown>) {
  const response = await request.post("/api/action", { data: { id, input } });
  expect((await response.json()).status).toBe("succeeded");
}

test("a calendar's chips are one line at the label size, and a busy day keeps its week's height", async ({
  page,
  request,
}) => {
  await page.clock.setFixedTime(new Date("2026-11-14T10:00:00"));
  await action(request, "node.add", {
    id: "cal.f.due",
    text: "Due",
    parent: ROOT,
    props: [
      { field: "sys.f.type", value: ref("sys.field") },
      { field: "sys.f.fieldType", value: ref("sys.ft.date") },
    ],
  });
  await action(request, "node.add", { id: FRAME, text: "Plan", parent: ROOT, position: 0 });
  const rows = [
    ["cal.n.1", "A row whose text is far longer than any day's cell is wide", "2026-11-11"],
    ["cal.n.2", "Second on Wednesday", "2026-11-11"],
    ["cal.n.3", "Third on Wednesday", "2026-11-11"],
    ["cal.n.4", "Short", "2026-11-19"],
  ] as const;
  for (const [id, text, due] of rows)
    await action(request, "node.add", {
      id,
      text,
      parent: FRAME,
      props: [{ field: "cal.f.due", value: str(due) }],
    });

  await page.goto(`/node/${FRAME}`);
  const toolbar = page.locator(`[data-view-toolbar][data-frame-id="${FRAME}"]`).first();
  const gear = page.locator(`[data-view-toolbar-gear][data-frame-id="${FRAME}"]`).first();
  await expect(toolbar.or(gear)).toBeVisible();
  if (await gear.isVisible()) await gear.click();
  await toolbar.locator('[data-mode-button="calendar"]').click();
  await toolbar.locator('[data-view-settings-button="true"]').click();
  const popover = page.getByTestId("view-settings-popover");
  await popover.locator('[data-qb-slot="date field"]').click();
  await page.keyboard.type("Due");
  await expect(page.locator('[role="option"]').filter({ hasText: /^\s*Due\s*$/ })).toBeVisible();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");

  const view = page.locator(`[data-calendar-view][data-frame-id="${FRAME}"]`);
  const long = view.locator('[data-calendar-chip="cal.n.1"]');
  await expect(long).toBeVisible();
  const short = await settledBox(view.locator('[data-calendar-chip="cal.n.4"]'));
  const longBox = await settledBox(long);
  // One line, whatever the text: the long chip is as tall as the short one, and short of a row's height.
  expect(Math.abs(longBox.height - short.height)).toBeLessThan(1);
  expect(longBox.height).toBeLessThan(22);
  const text = long.locator(".kb-text-row");
  expect(await text.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  expect(await text.evaluate((el) => getComputedStyle(el).textOverflow)).toBe("ellipsis");

  // Wednesday's three chips do not grow its week past a quiet one.
  const busy = await settledBox(view.locator('[data-calendar-day="2026-11-11"]'));
  const quiet = await settledBox(view.locator('[data-calendar-day="2026-11-25"]'));
  expect(Math.abs(busy.height - quiet.height)).toBeLessThan(1);
});
