// Deliberately .e2e.ts: Bun's recursive unit-test discovery must not load it.
//
// The scroll region keeps no scrollbar gutter: its scrollbar is kb's own
// thumb over its right edge (`RegionScrollbar`, `index.css`), so a
// region-spanning backdrop fills the layer under it. With classic scrollbars
// on (`playwright.config.ts`), at both content widths and on a phone: the
// region's content box is its whole width, dragging the thumb and a wheel over
// it scroll the region, and no text or control the region shows sits under
// the thumb's track — the content keeps its right inset.
import type { APIRequestContext, Page } from "playwright/test";
import { expect, test } from "./harness-test.ts";

const ROOT = "render.fixture.root";
const ROWS = 60;
/** A row long enough to wrap at any width, so the column's right edge is reached. */
const LONG = Array.from({ length: 40 }, (_, i) => `wrapping${i}`).join(" ");
const CONTENT_WIDTHS = ["centered", "full"] as const;
const WINDOWS = [
  { width: 1280, height: 900 },
  { width: 390, height: 844 },
] as const;

const REGION = '[data-main-region="scroll"]';
const TRACK = ".kb-region-scrollbar";
const THUMB = ".kb-region-thumb";

async function addRows(request: APIRequestContext) {
  for (let i = 0; i < ROWS; i++) {
    const text = i % 5 === 0 ? `Row ${i} ${LONG}` : `Row ${i}`;
    const res = await request.post("/api/action", {
      data: { id: "node.add", input: { id: `region.row.${i}`, text, parent: ROOT } },
    });
    expect((await res.json()).status).toBe("succeeded");
  }
}

async function setContentWidth(page: Page, width: (typeof CONTENT_WIDTHS)[number]) {
  await page.evaluate((mode) => {
    const key = "kb-prefs";
    const next = JSON.stringify({ ...JSON.parse(localStorage.getItem(key) ?? "{}"), width: mode });
    localStorage.setItem(key, next);
    window.dispatchEvent(new StorageEvent("storage", { key, newValue: next }));
  }, width);
  await expect(page.locator("html")).toHaveAttribute("data-width", width);
}

/** The region's gutter: how much narrower its content box is than its border box. */
function gutterOf(page: Page) {
  return page.evaluate((selector) => {
    const region = document.querySelector<HTMLElement>(selector);
    return region ? region.offsetWidth - region.clientWidth : -1;
  }, REGION);
}

/**
 * Every text run and control in the region whose box, within the region's
 * visible height, meets the track: each as its tag and the text it starts with.
 */
function underTrack(page: Page) {
  return page.evaluate(
    ({ regionSelector, trackSelector }) => {
      const region = document.querySelector<HTMLElement>(regionSelector);
      const track = document.querySelector(trackSelector)?.getBoundingClientRect();
      if (!region || !track) return ["no region or no track"];
      const view = region.getBoundingClientRect();
      const meets = (box: DOMRect) =>
        box.width > 0 &&
        box.height > 0 &&
        box.right > track.left &&
        box.left < track.right &&
        box.bottom > Math.max(track.top, view.top) &&
        box.top < Math.min(track.bottom, view.bottom);
      const seen = { opacityProperty: true, visibilityProperty: true };
      const found: string[] = [];
      const walker = document.createTreeWalker(region, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const parent = node.parentElement;
        const text = (node.textContent ?? "").trim();
        if (text === "" || !parent || !parent.checkVisibility(seen)) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        if ([...range.getClientRects()].some(meets))
          found.push(`text in <${parent.tagName.toLowerCase()}>: ${text.slice(0, 30)}`);
      }
      const controls = region.querySelectorAll(
        'a, button, input, select, textarea, [contenteditable="true"], [role="button"], [tabindex]',
      );
      for (const control of controls) {
        if (control.checkVisibility(seen) && meets(control.getBoundingClientRect()))
          found.push(`<${control.tagName.toLowerCase()}>: ${control.textContent.slice(0, 30)}`);
      }
      return found;
    },
    { regionSelector: REGION, trackSelector: TRACK },
  );
}

test("the scroll region keeps no gutter, and its content stays clear of the thumb", async ({
  page,
  request,
}) => {
  await addRows(request);
  for (const viewport of WINDOWS) {
    await page.setViewportSize(viewport);
    await page.goto(`/node/${ROOT}`);
    await expect(page.getByText(`Row ${ROWS - 1}`, { exact: true })).toBeAttached();
    for (const width of CONTENT_WIDTHS) {
      const label = `${width} ${viewport.width}`;
      await setContentWidth(page, width);
      expect(await gutterOf(page), `${label}: the region keeps a gutter`).toBe(0);
      await expect
        .poll(() => underTrack(page), { message: `${label}: content under the thumb's track` })
        .toEqual([]);
      // Scrolled to the end, the rows there are clear of it too.
      await page.locator(REGION).evaluate((region) => {
        region.scrollTop = region.scrollHeight;
      });
      await expect
        .poll(() => underTrack(page), { message: `${label}, scrolled: content under the track` })
        .toEqual([]);
      await page.locator(REGION).evaluate((region) => {
        region.scrollTop = 0;
      });
    }
  }
});

test("dragging the region's thumb, or a wheel over it, scrolls the region", async ({
  page,
  request,
}) => {
  await addRows(request);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/node/${ROOT}`);
  await expect(page.getByText(`Row ${ROWS - 1}`, { exact: true })).toBeAttached();
  const region = page.locator(REGION);
  const scrollTop = () => region.evaluate((element) => element.scrollTop);

  const thumb = page.locator(THUMB);
  await thumb.hover();
  await expect(thumb, "the thumb shows under the pointer").toHaveCSS("opacity", "1");
  const box = await thumb.boundingBox();
  if (box === null) throw new Error("the thumb has no box");
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + 200, { steps: 5 });
  await page.mouse.up();
  await expect.poll(scrollTop, { message: "the drag scrolls the region" }).toBeGreaterThan(0);
  const dragged = await scrollTop();
  await expect(thumb, "the thumb follows the scroll").not.toHaveCSS("transform", "none");

  const moved = await thumb.boundingBox();
  if (moved === null) throw new Error("the thumb has no box");
  await page.mouse.move(moved.x + moved.width / 2, moved.y + moved.height / 2);
  await page.mouse.wheel(0, 400);
  await expect
    .poll(scrollTop, { message: "a wheel over the thumb scrolls the region" })
    .toBeGreaterThan(dragged);
});
