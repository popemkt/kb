// Deliberately .e2e.ts: Bun's recursive unit-test discovery must not load it.
//
// A page-head backdrop paints behind the page's content, never over it
// (DESIGN-UI.md → Page-head backdrops → One slot): its frame reaches below
// the head, and whatever lies under that reach (the title, the field rows, a
// tag page's Fields section, the outline's rows) still paints above it, at
// full opacity, however it is positioned. For every contributed backdrop, on
// the outline's home, a node's page and a tag's page, in light and dark and
// at every strength, the frame is made hit-testable for a moment and every
// point of the content's text that lies inside it is hit-tested: the topmost
// box there is the content's own, never one of the backdrop's. A screenshot
// of the tag page with the Black hole's Warp at vivid, in light and in dark,
// is written beside the run.
import {
  BACKDROP_STRENGTHS,
  BACKDROP_STRENGTH_OPTION_IDS,
  type BackdropStrength,
} from "@kb/appearance";
import { SYSTEM_IDS } from "@kb/model";
import type { APIRequestContext, Page } from "playwright/test";
import { expect, test } from "./harness-test.ts";
import { backdropOptions } from "./backdrop-options.ts";

const CORE = "sys.extension.core";
const TAG = "render.fixture.tag";
const PAGES = [
  { name: "home", path: "/" },
  { name: "node", path: "/node/render.fixture.root" },
  { name: "tag", path: `/node/${TAG}` },
] as const;
const SCHEMES = ["light", "dark"] as const;
const FRAME = ".kb-header-backdrop-space .kb-header-backdrop";
const WARP = "sys.backdrop-variant.backdrops.black-hole.warp";
const BLACK_HOLE = "sys.backdrop.backdrops.black-hole";

const ref = (v: string) => ({ t: "ref", v });

async function action(request: APIRequestContext, id: string, input: Record<string, unknown>) {
  const response = await request.post("/api/action", { data: { id, input } });
  const receipt = await response.json();
  expect(receipt.status, JSON.stringify(receipt)).toBe("succeeded");
  return receipt;
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

/**
 * The content's text the backdrop's frame covers: every visible text run in
 * the scroll region, outside the head's backdrop space, whose centre lies in
 * the frame, and whose topmost box there is one of the backdrop's. The frame
 * is `pointer-events: none`, which hit-testing honours, so it is made
 * hit-testable while the points are tested and restored after.
 */
function coveredText(frameSelector: string): string[] {
  const frame = document.querySelector<HTMLElement>(frameSelector);
  const region = document.querySelector<HTMLElement>("[data-main-region]");
  if (frame === null || region === null) return ["<no frame or region>"];
  const box = frame.getBoundingClientRect();
  /** A point the frame covers, on screen. */
  const framed = (x: number, y: number): boolean =>
    x > Math.max(box.left, 0) &&
    x < Math.min(box.right, innerWidth) &&
    y > Math.max(box.top, 0) &&
    y < Math.min(box.bottom, innerHeight);
  /** The centres of the content's visible text runs, each with its words. */
  const runs: { words: string; x: number; y: number }[] = [];
  const walker = document.createTreeWalker(region, NodeFilter.SHOW_TEXT);
  for (let text = walker.nextNode(); text !== null; text = walker.nextNode()) {
    const owner = text.parentElement;
    const words = text.textContent?.trim() ?? "";
    const content =
      owner !== null &&
      words !== "" &&
      owner.closest(".kb-header-backdrop-space") === null &&
      owner.checkVisibility({ visibilityProperty: true, opacityProperty: true });
    if (!content) continue;
    const range = document.createRange();
    range.selectNodeContents(text);
    for (const rect of range.getClientRects()) {
      runs.push({ words, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
    }
  }
  const probe = document.createElement("style");
  probe.textContent =
    ".kb-header-backdrop, .kb-header-backdrop * { pointer-events: auto !important; }";
  document.head.append(probe);
  try {
    return runs
      .filter(({ x, y }) => framed(x, y))
      .filter(({ x, y }) => {
        const hit = document.elementFromPoint(x, y);
        return hit !== null && hit.closest(".kb-header-backdrop") !== null;
      })
      .map(({ words }) => words.slice(0, 40));
  } finally {
    probe.remove();
  }
}

/** Wait out the page's enter transition, so its content is where it settles. */
const settled = (page: Page) =>
  page.waitForFunction(() =>
    document.getAnimations().every((animation) => animation.playState !== "running"),
  );

async function setStrength(request: APIRequestContext, strength: BackdropStrength) {
  await action(request, "node.update", {
    id: CORE,
    setProps: [
      {
        field: SYSTEM_IDS.backdropStrengthField,
        value: ref(BACKDROP_STRENGTH_OPTION_IDS[strength]),
      },
    ],
  });
}

/**
 * One page with one backdrop: in each scheme and at each strength, the
 * content's text the backdrop covers, one line per case. A tag page with the
 * Black hole is photographed in each scheme, once its scene has drawn.
 */
async function coveredOn(
  page: Page,
  request: APIRequestContext,
  label: string,
  shot: ((scheme: string) => string) | null,
): Promise<string[]> {
  const failures: string[] = [];
  await expect(page.locator(FRAME), `${label}: no backdrop`).toBeAttached();
  await expect(page.locator(".outline-editor")).toBeVisible();
  for (const scheme of SCHEMES) {
    await setScheme(page, scheme);
    for (const strength of BACKDROP_STRENGTHS) {
      await setStrength(request, strength);
      await settled(page);
      const covered = await page.evaluate(coveredText, FRAME);
      if (covered.length > 0)
        failures.push(`${label} ${scheme} ${strength}: ${covered.join(" | ")}`);
    }
    if (shot === null) continue;
    await page
      .locator(`${FRAME} [data-scene-state]`)
      .waitFor({ timeout: 10_000 })
      .catch(() => undefined);
    await expect(page.locator(`${FRAME} [data-scene-state="loading"]`)).toHaveCount(0, {
      timeout: 20_000,
    });
    await page.screenshot({ path: shot(scheme) });
  }
  return failures;
}

for (const option of backdropOptions) {
  test(`stacking ${option}: a page-head backdrop never covers the page's content`, async ({
    browser,
    request,
    harness,
  }, testInfo) => {
    test.setTimeout(900_000);
    // A tag with a field of its own, so its page shows the Fields section with a row in it.
    await action(request, "node.add", {
      id: "stacking.f.status",
      text: "status",
      parent: "render.fixture.root",
      props: [{ field: "sys.f.type", value: ref("sys.field") }],
    });
    await action(request, "node.update", {
      id: TAG,
      setProps: [{ field: "sys.f.fields", value: ref("stacking.f.status") }],
    });
    // The Black hole shows Warp, the look the owner's page shows.
    await action(request, "node.update", {
      id: CORE,
      setProps: [{ field: SYSTEM_IDS.backdropVariantField, value: ref(WARP) }],
    });

    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    const failures: string[] = [];
    try {
      await action(request, "node.update", {
        id: CORE,
        setProps: [{ field: SYSTEM_IDS.backdropField, value: ref(option) }],
      });
      for (const { name, path } of PAGES) {
        await page.goto(`${harness.url}${path}?backdrop-seed=1`);
        const shot =
          option === BLACK_HOLE && name === "tag"
            ? (scheme: string) => testInfo.outputPath(`tag-warp-vivid-${scheme}.png`)
            : null;
        failures.push(...(await coveredOn(page, request, `${option} ${name}`, shot)));
      }
    } finally {
      await context.close();
    }
    expect(failures, "content text the backdrop paints over").toEqual([]);
  });
}
