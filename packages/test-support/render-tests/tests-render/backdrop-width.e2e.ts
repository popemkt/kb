// Deliberately .e2e.ts: Bun's recursive unit-test discovery must not load it.
//
// A backdrop whose frame spans the scroll region is composed from the head's
// height, never its width (DESIGN-UI.md → Page-head backdrops → GPU scenes →
// Framing by width): a wider window, or the full content width, adds field at
// the sides and leaves the hero where it was, as large as it was. For every
// contributed GPU backdrop that spans the region, one tab loads the home page
// under reduced motion (so each load draws the same piece) and then, while it
// runs, switches the content width and resizes the window: the hero the
// canvas reports (`data-hero`, heights from the content's centre) holds, the
// frame always spans the region without scrolling the page sideways, the
// canvas is never replaced and no frame it shows is blank.
import { SYSTEM_IDS } from "@kb/model";
import type { APIRequestContext, Page } from "playwright/test";
import { expect, test } from "./harness-test.ts";

/** Window widths at which a page head is wide (its frame past `WIDE_WIDTH` with the sidebar open). */
const WIDE_WINDOWS = [1280, 1440, 1920, 2560] as const;
const CONTENT_WIDTHS = ["full", "centered"] as const;
/** How far the hero may move or grow between widths, in heights: a rounding, never a step. */
const HOLD = 0.005;
/** A frame whose luma spreads less than this (0–255) is one flat colour: blank. */
const BLANK_SPREAD = 4;

const FRAME = ".kb-header-backdrop-space .kb-header-backdrop";
const HOST = `${FRAME} .kb-gpu-backdrop`;

async function action(request: APIRequestContext, id: string, input: Record<string, unknown>) {
  const response = await request.post("/api/action", { data: { id, input } });
  const receipt = await response.json();
  expect(receipt.status, JSON.stringify(receipt)).toBe("succeeded");
  return receipt;
}

/** Counts the head's canvases removed from the first script on. */
function countRemovedCanvases() {
  const record = { removed: 0 };
  Object.assign(window, { kbWidth: record });
  new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.removedNodes) {
        if (node instanceof HTMLCanvasElement) record.removed += 1;
      }
    }
  }).observe(document, { subtree: true, childList: true });
}

/** The hero the canvas reports: x and y in heights, and its scale. */
async function heroOf(page: Page): Promise<readonly number[]> {
  const hero = await page.locator(`${HOST} canvas`).getAttribute("data-hero");
  return (hero ?? "").split(" ").filter(Boolean).map(Number);
}

/** Switches the content width as another tab would, through the prefs' storage event. */
async function setContentWidth(page: Page, mode: (typeof CONTENT_WIDTHS)[number]) {
  await page.evaluate((width) => {
    const key = "kb-prefs";
    const next = JSON.stringify({ ...JSON.parse(localStorage.getItem(key) ?? "{}"), width });
    localStorage.setItem(key, next);
    window.dispatchEvent(new StorageEvent("storage", { key, newValue: next }));
  }, mode);
  await expect(page.locator("html")).toHaveAttribute("data-width", mode);
}

/** How far the frame's luma spreads (its standard deviation, 0–255), as the screen shows it. */
async function spreadOf(page: Page): Promise<number> {
  const shot = await page.locator(FRAME).screenshot();
  return page.evaluate(async (png) => {
    const image = new Image();
    image.src = `data:image/png;base64,${png}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d");
    context?.drawImage(image, 0, 0);
    const data =
      context?.getImageData(0, 0, image.width, image.height).data ?? new Uint8ClampedArray(0);
    let sum = 0;
    let squares = 0;
    const n = data.length / 4;
    for (let i = 0; i < data.length; i += 4) {
      const [r = 0, g = 0, b = 0] = data.subarray(i, i + 3);
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      sum += luma;
      squares += luma * luma;
    }
    const mean = sum / n;
    return Math.sqrt(Math.max(0, squares / n - mean * mean));
  }, shot.toString("base64"));
}

/**
 * The frame spans the scroll region's width once the resize has laid out
 * (a forced layout reads a container's old width until the next frame),
 * and the page does not scroll sideways.
 */
async function expectSpansRegion(page: Page, label: string) {
  const fit = () =>
    page.evaluate((frame) => {
      const box = document.querySelector(frame)?.getBoundingClientRect();
      const region = document.querySelector<HTMLElement>('[data-main-region="scroll"]');
      return {
        short: (region?.clientWidth ?? -1) - Math.round(box?.width ?? 0),
        sideways: document.documentElement.scrollWidth - window.innerWidth,
      };
    }, FRAME);
  await expect
    .poll(fit, { message: `${label}: the frame spans the region, and the page stays put` })
    .toEqual({ short: 0, sideways: 0 });
}

test("a backdrop that spans the region holds its hero whatever the width", async ({
  browser,
  request,
  harness,
  gpu,
}) => {
  test.setTimeout(300_000);
  // GAP [[01M3E6QH4WZFJQTQM96NBZ7VVA]]
  test.skip(!gpu.webgpu, "the hero is reported by a running GPU scene");
  const field = await action(request, "node.get", { id: SYSTEM_IDS.backdropField });
  const options = (field.output.node.children as ReadonlyArray<{ id: string }>).map(
    (child) => child.id,
  );
  const tried: string[] = [];
  for (const option of options) {
    await action(request, "node.update", {
      id: "sys.extension.core",
      setProps: [{ field: SYSTEM_IDS.backdropField, value: { t: "ref", v: option } }],
    });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    await page.addInitScript(countRemovedCanvases);
    await page.goto(harness.url);
    const host = page.locator(HOST);
    const isGpu = await host
      .waitFor({ timeout: 8000 })
      .then(() => true)
      .catch(() => false);
    const spans =
      isGpu && (await page.locator(FRAME).evaluate((el) => el.classList.contains("kb-breakout")));
    if (!spans) {
      await context.close();
      continue;
    }
    tried.push(option);
    await expect(host).toHaveAttribute("data-scene-state", "ready", { timeout: 20_000 });
    const first = await heroOf(page);
    expect(first.length, `${option}: the canvas reports its hero`).toBe(3);

    for (const mode of CONTENT_WIDTHS) {
      await setContentWidth(page, mode);
      for (const width of WIDE_WINDOWS) {
        const label = `${option} ${mode} ${width}`;
        await page.setViewportSize({ width, height: 900 });
        // The hero settles where it was: every part within a rounding of the first load's.
        await expect
          .poll(
            async () => {
              const hero = await heroOf(page);
              return Math.max(...first.map((v, i) => Math.abs(v - (hero[i] ?? Infinity))));
            },
            { message: `${label}: the hero moved or grew` },
          )
          .toBeLessThanOrEqual(HOLD);
        await expectSpansRegion(page, label);
        expect.soft(await spreadOf(page), `${label}: a blank frame`).toBeGreaterThan(BLANK_SPREAD);
      }
    }

    // A phone: the panel's composition, still drawn and still inside the page.
    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(() => heroOf(page).then((hero) => hero.length)).toBe(3);
    await expectSpansRegion(page, `${option} phone`);
    expect
      .soft(await spreadOf(page), `${option} phone: a blank frame`)
      .toBeGreaterThan(BLANK_SPREAD);

    const removed = await page.evaluate(
      () => (window as unknown as { kbWidth: { removed: number } }).kbWidth.removed,
    );
    expect.soft(removed, `${option}: canvases removed while it ran`).toBe(0);
    await expect(host).toHaveAttribute("data-scene-state", "ready");
    await context.close();
  }
  expect(tried.length, "no backdrop spans the region").toBeGreaterThan(0);
});
