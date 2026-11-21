// Deliberately .e2e.ts: Bun's recursive unit-test discovery must not load it.
//
// The head's crumbs never scroll sideways (DESIGN-UI.md → Node pages): at a
// phone's width a day's path (Home › Daily notes › 2026 › Week 47 › the
// day) folds its middle into "…", Home and the day stay, a long name is cut
// with an ellipsis, and "…" opens the folded crumbs from the keyboard.
import type { APIRequestContext, Page } from "playwright/test";
import { expect, test } from "./harness-test.ts";

const DAY = "2026-11-22";

/** Run kb action `id` over the API; its output. */
async function call(request: APIRequestContext, id: string, input: unknown): Promise<unknown> {
  const response = await request.post("/api/action", { data: { id, input } });
  const receipt = (await response.json()) as { status: string; message?: string; output?: unknown };
  expect(receipt.status, receipt.message).toBe("succeeded");
  return receipt.output;
}

/** A day's node, days switched on to make it. */
async function dayNode(request: APIRequestContext): Promise<string> {
  await call(request, "extension.switch", { name: "days", on: true });
  const { id } = (await call(request, "ext.days.today", { day: DAY })) as { id: string };
  return id;
}

/** How far the page's widest sideways scroller (the document, or a box that scrolls) reaches past its box, in px. */
function sidewaysOverflow(page: Page): Promise<number> {
  return page.evaluate(() =>
    Math.max(
      0,
      ...[document.documentElement, ...document.querySelectorAll<HTMLElement>("main, main *")]
        .filter(
          (el) =>
            el === document.documentElement ||
            ["auto", "scroll"].includes(getComputedStyle(el).overflowX),
        )
        .map((el) => el.scrollWidth - el.clientWidth),
    ),
  );
}

function crumbs(page: Page) {
  return page.getByRole("navigation", { name: "Breadcrumb" });
}

for (const width of [320, 375, 768]) {
  test(`a day's crumbs fit ${width}px, Home and the day on screen`, async ({ page, request }) => {
    const day = await dayNode(request);
    await page.setViewportSize({ width, height: 700 });
    await page.goto(`/node/${day}`);
    const row = crumbs(page);
    await expect(row.getByRole("button", { name: "Home" })).toBeVisible();
    const current = row.locator('[aria-current="page"]');
    await expect(current).toBeVisible();
    await expect(current).toHaveText("Sun, Nov 22");
    await expect.poll(() => sidewaysOverflow(page)).toBe(0);
    const folded = row.locator('button[aria-haspopup="menu"]');
    if (width === 768) await expect(folded).toBeHidden();
    else await expect(folded).toBeVisible();
  });
}

test("'…' opens the folded crumbs from the keyboard, and a row opens its node", async ({
  page,
  request,
}) => {
  const day = await dayNode(request);
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto(`/node/${day}`);
  const folded = crumbs(page).locator('button[aria-haspopup="menu"]');
  // Reached from the keyboard, it names what it folds, as it does on hover.
  await folded.focus();
  await expect(folded).toHaveAttribute("title", /^Daily notes › 2026/u);
  await page.keyboard.press("Enter");
  const menu = page.getByRole("menu", { name: "Folded crumbs" });
  await expect(menu.getByRole("menuitem").first()).toBeFocused();
  await expect(menu.getByRole("menuitem").first()).toHaveText("Daily notes");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(menu).toHaveCount(0);
  await expect(crumbs(page).locator('[aria-current="page"]')).toHaveText("2026");
});

test("a long current name is cut with an ellipsis, not scrolled", async ({ page, request }) => {
  const day = await dayNode(request);
  const { id } = (await call(request, "node.add", {
    parent: day,
    text: "A very long meeting note title about the quarterly planning offsite agenda and follow-ups",
  })) as { id: string };
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto(`/node/${id}`);
  const current = crumbs(page).locator('[aria-current="page"]');
  await expect(current).toBeVisible();
  await expect(crumbs(page).getByRole("button", { name: "Home" })).toBeVisible();
  await expect.poll(() => sidewaysOverflow(page)).toBe(0);
  expect(await current.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
});
