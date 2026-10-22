// Deliberately .e2e.ts: Bun's recursive unit-test discovery must not load it.
//
// Layout the unit suite cannot see: whether something painted outside its box
// makes the page scroll sideways, and whether an absolutely placed badge is
// clipped. Only a real engine measuring real boxes can answer either.
import type { Page } from "playwright/test";
import { expect, test } from "./harness-test.ts";

async function home(page: Page, width: number) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto("/");
  await expect(page.locator("[data-bullet-count]").first()).toBeVisible();
}

/** The main region's own sideways overflow, and each count badge's box against it. */
function measure(page: Page) {
  return page.evaluate(() => {
    const main = document.querySelector("[data-main-region]");
    if (!(main instanceof HTMLElement)) return null;
    const frame = main.getBoundingClientRect();
    const badges = [...document.querySelectorAll("[data-bullet-count]")].map((el) => {
      const box = el.getBoundingClientRect();
      return { left: box.left, right: box.right, text: el.textContent };
    });
    return {
      overflow: main.scrollWidth - main.clientWidth,
      pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      frameLeft: frame.left,
      badges,
    };
  });
}

type Measure = NonNullable<Awaited<ReturnType<typeof measure>>>;

/**
 * The layout once it has stopped moving: two measurements in a row that
 * agree, with at least one count badge laid out. Rows mount and fonts swap
 * after the first badge is visible, so the first sample that happens to pass
 * can still be a frame in motion; the assertions run once, on this one.
 */
async function settled(page: Page): Promise<Measure> {
  const last: { m: Measure | null; key: string } = { m: null, key: "" };
  await expect
    .poll(
      async () => {
        const m = await measure(page);
        const key = JSON.stringify(m);
        const still = m !== null && m.badges.length > 0 && key === last.key;
        last.m = m;
        last.key = key;
        return still;
      },
      { intervals: [100, 250] },
    )
    .toBe(true);
  if (last.m === null) throw new Error("no main region");
  return last.m;
}

for (const width of [1280, 390]) {
  test(`home at ${width}px never scrolls sideways, and its header wash stays inside`, async ({
    page,
  }) => {
    await home(page, width);
    await expect(page.locator("[data-header-wash]")).toHaveCount(1);
    const m = await settled(page);
    expect(m.overflow).toBe(0);
    expect(m.pageOverflow).toBe(0);
  });

  test(`home at ${width}px shows every child count whole`, async ({ page }) => {
    await home(page, width);
    const m = await settled(page);
    for (const badge of m.badges) {
      expect(badge.left, `count ${badge.text}`).toBeGreaterThanOrEqual(m.frameLeft);
    }
  });
}

const LONG_TITLE =
  "A page title long enough that no page is wide enough to hold it on one line, ".repeat(2);

/** The page heading's box against its text: overflow it hides, and how many lines it takes. */
function titleBox(page: Page, selector: string) {
  return page.locator(selector).evaluate((el) => {
    const box = el.getBoundingClientRect();
    const lineHeight = Number.parseFloat(getComputedStyle(el).lineHeight);
    return {
      hidden: el.scrollWidth - el.clientWidth,
      lines: Math.round((box.height - 8) / lineHeight),
      height: box.height,
      text: el.textContent,
    };
  });
}

for (const width of [1280, 390]) {
  test(`a long page title at ${width}px wraps whole, and keeps its shape while edited`, async ({
    page,
    request,
  }) => {
    const response = await request.post("/api/action", {
      data: { id: "node.add", input: { id: "layout.long", text: LONG_TITLE.trim(), position: 0 } },
    });
    expect((await response.json()).status).toBe("succeeded");
    await home(page, width);
    await page
      .locator('[data-node-id="layout.long"] button.bullet-container')
      .first()
      .click({ modifiers: ["ControlOrMeta"] });

    const view = await titleBox(page, "[data-zoom-title]");
    expect(view.text).toBe(LONG_TITLE.trim());
    expect(view.hidden).toBe(0);
    expect(view.lines).toBeGreaterThan(1);

    await page.locator("[data-zoom-title]").click();
    const edit = await titleBox(page, "[data-zoom-title-editor]");
    expect(edit.hidden).toBe(0);
    expect(edit.height).toBe(view.height);

    const m = await measure(page);
    expect(m?.overflow).toBe(0);
  });
}
