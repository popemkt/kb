// Deliberately .e2e.ts: Bun's recursive unit-test discovery must not load it.
//
// The rows a page head's space holds read over any backdrop (DESIGN-UI.md →
// Page-head backdrops → One slot): the breadcrumbs stand over the top of the
// backdrop, on the head's scrim, and keep AA contrast. For every contributed
// backdrop at its strongest, on the outline's home and on a node's page, in
// light and in dark, the breadcrumbs' text is made transparent for a moment
// and the band is photographed: each crumb's colour is held against every
// pixel of its box, and the least contrast found must be at least 4.5:1.
import { BACKDROP_STRENGTH_OPTION_IDS } from "@kb/appearance";
import { SYSTEM_IDS } from "@kb/model";
import { bundledSeed } from "@kb/bundled";
import type { APIRequestContext, Page } from "playwright/test";
import { expect, test } from "./harness-test.ts";
import { backdropOptions } from "./backdrop-options.ts";

const CORE = "sys.extension.core";
const PAGES = [
  { name: "home", path: "/" },
  { name: "node", path: "/node/render.fixture.root" },
] as const;
const SCHEMES = ["light", "dark"] as const;
const FRAME = ".kb-header-backdrop-space .kb-header-backdrop";
/** WCAG 2's AA for text of the breadcrumbs' size. */
const AA = 4.5;

const ref = (v: string) => ({ t: "ref", v });

async function action(request: APIRequestContext, id: string, input: Record<string, unknown>) {
  const response = await request.post("/api/action", { data: { id, input } });
  const receipt = await response.json();
  expect(receipt.status, JSON.stringify(receipt)).toBe("succeeded");
}

/** Switches the scheme as another tab would, through the prefs' storage event. */
async function setScheme(page: Page, scheme: (typeof SCHEMES)[number]) {
  await page.evaluate((theme) => {
    const key = "kb-prefs";
    const next = JSON.stringify({ ...JSON.parse(localStorage.getItem(key) ?? "{}"), theme });
    localStorage.setItem(key, next);
    window.dispatchEvent(new StorageEvent("storage", { key, newValue: next }));
  }, scheme);
  await expect
    .poll(() => page.evaluate(() => document.documentElement.classList.contains("dark")))
    .toBe(scheme === "dark");
}

interface Crumb {
  readonly text: string;
  /** Its colour in sRGB, 0–255. */
  readonly color: readonly number[];
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Each crumb that shows text: its words, its colour as painted, and its box. */
function crumbsShown(): Crumb[] {
  const paint = document.createElement("canvas");
  paint.width = 1;
  paint.height = 1;
  const pen = paint.getContext("2d", { willReadFrequently: true });
  const srgb = (css: string): number[] => {
    if (pen === null) return [0, 0, 0];
    pen.clearRect(0, 0, 1, 1);
    pen.fillStyle = css;
    pen.fillRect(0, 0, 1, 1);
    return Array.from(pen.getImageData(0, 0, 1, 1).data.slice(0, 3));
  };
  return [...document.querySelectorAll<HTMLElement>("nav.breadcrumbs *")]
    .filter((element) =>
      [...element.childNodes].some(
        (child) => child.nodeType === Node.TEXT_NODE && (child.textContent ?? "").trim() !== "",
      ),
    )
    .map((element) => {
      const box = element.getBoundingClientRect();
      return {
        text: element.textContent.trim().slice(0, 40),
        color: srgb(getComputedStyle(element).color),
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
      };
    });
}

/** The least contrast of each crumb against every pixel of its box in `png` (base64): its words and the ratio. */
async function leastContrast({
  crumbs,
  png,
}: {
  readonly crumbs: readonly Crumb[];
  readonly png: string;
}): Promise<{ text: string; ratio: number }[]> {
  const image = new Image();
  image.src = `data:image/png;base64,${png}`;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const pen = canvas.getContext("2d", { willReadFrequently: true });
  if (pen === null) return [];
  pen.drawImage(image, 0, 0);
  // Each sRGB channel value 0–255 as linear light (WCAG 2); this runs in the page, so it is spelled out here.
  const linear = Array.from({ length: 256 }, (_, v) => {
    const c = v / 255;
    return c <= 0.040_45 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const lum = (rgb: ArrayLike<number>, at: number) =>
    0.2126 * (linear[rgb[at] ?? 0] ?? 0) +
    0.7152 * (linear[rgb[at + 1] ?? 0] ?? 0) +
    0.0722 * (linear[rgb[at + 2] ?? 0] ?? 0);
  return crumbs.map(({ text, color, x, y, width, height }) => {
    const ink = lum(color, 0);
    const pixels = pen.getImageData(
      Math.round(x),
      Math.round(y),
      Math.max(1, Math.round(width)),
      Math.max(1, Math.round(height)),
    ).data;
    let least = Number.POSITIVE_INFINITY;
    for (let i = 0; i < pixels.length; i += 4) {
      const ground = lum(pixels, i);
      const ratio = (Math.max(ink, ground) + 0.05) / (Math.min(ink, ground) + 0.05);
      least = Math.min(least, ratio);
    }
    return { text, ratio: Math.round(least * 100) / 100 };
  });
}

/** The crumbs whose text falls under AA on this page as it is drawn now, one line each. */
async function unreadable(page: Page, label: string): Promise<string[]> {
  const crumbs = await page.evaluate(crumbsShown);
  expect(crumbs.length, `${label}: no breadcrumbs`).toBeGreaterThan(0);
  const HIDDEN = "kb-head-band-hidden";
  await page.evaluate((id) => {
    const style = document.createElement("style");
    style.id = id;
    style.textContent = "nav.breadcrumbs, nav.breadcrumbs * { color: transparent !important; }";
    document.head.append(style);
  }, HIDDEN);
  const top = Math.max(...crumbs.map(({ y, height }) => y + height)) + 8;
  const png = await page.screenshot({ clip: { x: 0, y: 0, width: 1280, height: top } });
  await page.evaluate((id) => document.getElementById(id)?.remove(), HIDDEN);
  const found = await page.evaluate(leastContrast, { crumbs, png: png.toString("base64") });
  return found
    .filter(({ ratio }) => ratio < AA)
    .map(({ text, ratio }) => `${label}: "${text}" at ${ratio}:1`);
}

const heads =
  bundledSeed("2026-01-01T00:00:00.000Z").find((node) => node.id === SYSTEM_IDS.backdropHeadField)
    ?.children ?? [];
expect(heads).toHaveLength(2);
for (const head of heads) {
  for (const option of backdropOptions) {
    test(`head band ${head} ${option}: the breadcrumbs keep AA contrast over the backdrop`, async ({
      browser,
      request,
      harness,
    }) => {
      // GAP [[01M789X4HZ130RY16R7ASVVVF7]]: the shadow halo is glyph-local;
      // box-wide AA cannot measure it. The owner approved the prototype by eye.
      test.skip(
        head === "sys.backdrop-head.shadow",
        "Glyph-local shadow contrast needs a different measurement",
      );
      test.setTimeout(300_000);
      await action(request, "node.update", {
        id: CORE,
        setProps: [
          { field: SYSTEM_IDS.backdropHeadField, value: ref(head) },
          { field: SYSTEM_IDS.backdropField, value: ref(option) },
          {
            field: SYSTEM_IDS.backdropStrengthField,
            value: ref(BACKDROP_STRENGTH_OPTION_IDS.vivid),
          },
        ],
      });
      // One still frame a load (Reduced motion), so the band is photographed as it stays.
      const context = await browser.newContext({
        viewport: { width: 1280, height: 900 },
        reducedMotion: "reduce",
      });
      const page = await context.newPage();
      const failures: string[] = [];
      try {
        for (const { name, path } of PAGES) {
          await page.goto(`${harness.url}${path}?backdrop-seed=1`);
          await expect(page.locator(FRAME), `${option} ${name}: no backdrop`).toBeAttached();
          for (const scheme of SCHEMES) {
            await setScheme(page, scheme);
            await expect(page.locator(`${FRAME} [data-scene-state="loading"]`)).toHaveCount(0, {
              timeout: 20_000,
            });
            await page.waitForFunction(() =>
              document.getAnimations().every((animation) => animation.playState !== "running"),
            );
            failures.push(...(await unreadable(page, `${option} ${name} ${scheme}`)));
          }
        }
      } finally {
        await context.close();
      }
      expect(failures, "breadcrumbs under AA contrast").toEqual([]);
    });
  }
}
