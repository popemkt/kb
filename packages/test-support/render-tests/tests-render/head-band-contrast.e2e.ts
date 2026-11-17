// Deliberately .e2e.ts: Bun's recursive unit-test discovery must not load it.
//
// The head's top row reads over any backdrop (DESIGN-UI.md → Page-head
// backdrops → "The head's top row reads over a backdrop"). For every
// contributed backdrop at its strongest, under each head (`shadow`, `fade`),
// on the outline's home and on a node's page, in light and in dark, the band
// is photographed in four looks: as drawn with its ink all but transparent
// (its ground, the halo or the fade included), with black ink and with
// white ink and no shadow (where its glyphs are), and with the band hidden
// (the backdrop alone). Then:
// - each crumb's ink, mixed at its alpha over the ground at its glyphs,
//   keeps AA contrast;
// - the band mixes no more of the page's ground into the backdrop just
//   around the rows than far from them at the same height: no backing;
// - the backdrop alone has almost no sharp edge at the crumbs' glyphs: its
//   art leaves the crumb row clear.
import { BACKDROP_STRENGTH_OPTION_IDS } from "@kb/appearance";
import { SYSTEM_IDS } from "@kb/model";
import { bundledSeed } from "@kb/bundled";
import type { APIRequestContext, Page } from "playwright/test";
import { expect, test } from "./harness-test.ts";
import { backdropOptions } from "./backdrop-options.ts";

const CORE = "sys.extension.core";
// Home and one level: a long path's row is not held yet. GAP [[01M7FAKNVRP32XMNHK3D98SAW8]]
const PAGES = [
  { name: "home", path: "/" },
  { name: "node", path: "/node/render.fixture.root" },
] as const;
const SCHEMES = ["light", "dark"] as const;
const FRAME = ".kb-header-backdrop-space .kb-header-backdrop";
/** WCAG 2's AA for text of the breadcrumbs' size. */
const AA = 4.5;
/** How far a glyph's halo reaches, in pixels: the band may change the backdrop that close to its ink. */
const HALO = 12;
/** How far around the rows a backing would show, in pixels. */
const REACH = 32;
/** The most more of the page's ground the band may mix in around its rows than far from them (0–1). */
const BACKING = 0.15;
/**
 * The largest share of the pixels at the crumbs' glyphs that may sit on a
 * sharp edge of the art (0–1): a star or a grain passes, a label or an
 * outline under the letters does not.
 */
const CLEAR = 0.1;
/** The least a backdrop pixel differs from the page's ground (sRGB luma) for the veil over it to be read. */
const SIGNAL = 24;
/** The least step between two neighbouring pixels (sRGB luma) that is an edge: a stroke of art, not a gradient's grain. */
const EDGE = 48;
/** How near a glyph, in pixels, the art lies under the ink. */
const NEAR = 2;
/**
 * How long a frame may take to settle, in ms: to leave `loading`, and to show
 * a look and hold it. Far above what an idle machine needs and spent only
 * while the frame has not settled, so a loaded macOS runner (the harness for
 * the next test boots beside this one) does not fail it, and a frame that
 * never settles still does. Playwright's 5 s default is shorter than a
 * screenshot pair takes there (run 43987386291).
 */
const SETTLE = 20_000;

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
  /** Its colour in sRGB 0–255, and its alpha 0–1: the ink as the page mixes it over the ground. */
  readonly color: readonly number[];
  readonly alpha: number;
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
  const rgba = (css: string): number[] => {
    if (pen === null) return [0, 0, 0, 255];
    pen.clearRect(0, 0, 1, 1);
    pen.fillStyle = css;
    pen.fillRect(0, 0, 1, 1);
    return Array.from(pen.getImageData(0, 0, 1, 1).data);
  };
  return [...document.querySelectorAll<HTMLElement>("nav.breadcrumbs *")]
    .filter((element) =>
      [...element.childNodes].some(
        (child) => child.nodeType === Node.TEXT_NODE && (child.textContent ?? "").trim() !== "",
      ),
    )
    .map((element) => {
      const box = element.getBoundingClientRect();
      const [r = 0, g = 0, b = 0, a = 255] = rgba(getComputedStyle(element).color);
      return {
        text: element.textContent.trim().slice(0, 40),
        color: [r, g, b],
        alpha: a / 255,
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
      };
    });
}

/** A shot's pixels: RGBA, row by row. */
interface Pixels {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8Array;
}

/** A box on the page, in CSS pixels. */
interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** The band in its four looks, over one clip at the page's top left. */
interface Band {
  readonly crumbs: readonly Crumb[];
  /** The crumb row: the breadcrumbs' own box. */
  readonly row: Box;
  /** The page's ground in sRGB 0–255: what a scrim, a halo or a fade mixes in. */
  readonly page: readonly number[];
  /** As drawn, its ink all but transparent: the ground, the halo or the fade included. */
  readonly ground: Pixels;
  /** Its ink black, then white, with no shadow: where its glyphs are. */
  readonly black: Pixels;
  readonly white: Pixels;
  /** The band hidden: the backdrop alone. */
  readonly bare: Pixels;
}

/** Each PNG (base64) as its pixels, RGBA in base64, decoded by the page's canvas. */
async function decodedInPage(
  pngs: readonly string[],
): Promise<{ width: number; height: number; rgba: string }[]> {
  return Promise.all(
    pngs.map(async (png) => {
      const image = new Image();
      image.src = `data:image/png;base64,${png}`;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const pen = canvas.getContext("2d", { willReadFrequently: true });
      if (pen === null) throw new Error("no 2d context");
      pen.drawImage(image, 0, 0);
      const bytes = pen.getImageData(0, 0, image.width, image.height).data;
      let text = "";
      for (let i = 0; i < bytes.length; i += 0x80_00)
        text += String.fromCharCode(...bytes.subarray(i, i + 0x80_00));
      return { width: image.width, height: image.height, rgba: btoa(text) };
    }),
  );
}

/** An sRGB channel value 0–255 as linear light (WCAG 2). */
function linear(value: number): number {
  const c = value / 255;
  return c <= 0.040_45 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** The relative luminance of an sRGB colour, 0–1 (WCAG 2). */
function luminance(r: number, g: number, b: number): number {
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** The luma of pixel `p` of `shot`, sRGB 0–255. */
function luma(shot: Pixels, p: number): number {
  const i = p * 4;
  return (
    0.299 * (shot.rgba[i] ?? 0) + 0.587 * (shot.rgba[i + 1] ?? 0) + 0.114 * (shot.rgba[i + 2] ?? 0)
  );
}

/** `box`'s pixels inside `shot`, as index ranges. */
function cellsOf(
  shot: Pixels,
  box: Box,
): { left: number; top: number; right: number; bottom: number } {
  return {
    left: Math.max(0, Math.round(box.x)),
    top: Math.max(0, Math.round(box.y)),
    right: Math.min(shot.width - 1, Math.round(box.x + box.width)),
    bottom: Math.min(shot.height - 1, Math.round(box.y + box.height)),
  };
}

/** The pixels ink covers at least half of: where black and white ink differ most. */
function glyphsOf({ black, white }: Band): Uint8Array {
  const glyph = new Uint8Array(white.width * white.height);
  for (let p = 0; p < glyph.length; p += 1)
    glyph[p] = luma(white, p) - luma(black, p) >= 128 ? 1 : 0;
  return glyph;
}

/** Each pixel's distance to the nearest glyph pixel (a two-pass city-block chamfer). */
function distanceTo(glyph: Uint8Array, width: number): Float32Array {
  const far = glyph.length;
  const distance = Float32Array.from(glyph, (on) => (on === 1 ? 0 : far));
  const height = glyph.length / width;
  const relax = (p: number, q: number) => {
    distance[p] = Math.min(distance[p] ?? far, (distance[q] ?? far) + 1);
  };
  for (let p = 0; p < distance.length; p += 1) {
    if (p % width > 0) relax(p, p - 1);
    if (p >= width) relax(p, p - width);
  }
  for (let p = distance.length - 1; p >= 0; p -= 1) {
    if (p % width < width - 1) relax(p, p + 1);
    if (p < (height - 1) * width) relax(p, p + width);
  }
  return distance;
}

/** The least contrast between crumb `crumb`'s ink, mixed at its alpha over the ground at its glyphs, and that ground. */
function inkContrast(band: Band, glyph: Uint8Array, crumb: Crumb): number {
  const { ground } = band;
  const [ir = 0, ig = 0, ib = 0] = crumb.color;
  const mix = (ink: number, under: number) => crumb.alpha * ink + (1 - crumb.alpha) * under;
  const { left, top, right, bottom } = cellsOf(ground, crumb);
  let least = Number.POSITIVE_INFINITY;
  for (let y = top; y < bottom; y += 1)
    for (let x = left; x < right; x += 1) {
      const p = y * ground.width + x;
      if (glyph[p] !== 1) continue;
      const [r = 0, g = 0, b = 0] = ground.rgba.subarray(p * 4, p * 4 + 3);
      const under = luminance(r, g, b);
      const ink = luminance(mix(ir, r), mix(ig, g), mix(ib, b));
      least = Math.min(least, (Math.max(ink, under) + 0.05) / (Math.min(ink, under) + 0.05));
    }
  return Math.round(least * 100) / 100;
}

/** The mean of a running sum, to two places; 0 for none. */
const meanOf = ({ sum, count }: { sum: number; count: number }): number =>
  count === 0 ? 0 : Math.round((sum / count) * 100) / 100;

/** How much of the page's ground the band mixes in, 0–1: just around the row, and far from it at the same height. */
interface Backing {
  readonly near: number;
  readonly far: number;
}

/**
 * How much of the page's ground the band mixes into the backdrop at the
 * row's height, just around the row (beyond its glyphs' halo) and far from
 * it: ground = bare + veil · (page − bare), read where the backdrop differs
 * enough from the page to tell.
 */
function backingOf(band: Band, distance: Float32Array): Backing {
  const { ground, bare, row } = band;
  const [pr = 0, pg = 0, pb = 0] = band.page;
  const pageLuma = 0.299 * pr + 0.587 * pg + 0.114 * pb;
  const sides = { near: { sum: 0, count: 0 }, far: { sum: 0, count: 0 } };
  const { top, bottom } = cellsOf(bare, row);
  const nearFrom = row.x - REACH;
  const nearTo = row.x + row.width + REACH;
  for (let y = top; y < bottom; y += 1)
    for (let x = 0; x < bare.width; x += 1) {
      const p = y * bare.width + x;
      const from = luma(bare, p) - pageLuma;
      const near = x >= nearFrom && x < nearTo;
      if (
        Math.abs(from) < SIGNAL ||
        (near && (distance[p] ?? 0) < HALO) ||
        (!near && x < nearTo + REACH)
      )
        continue;
      const side = near ? sides.near : sides.far;
      side.sum += Math.min(1, Math.max(0, (luma(bare, p) - luma(ground, p)) / from));
      side.count += 1;
    }
  return { near: meanOf(sides.near), far: meanOf(sides.far) };
}

/** The share of the row's pixels within `NEAR` of a glyph that sit on a sharp edge of the backdrop's art. */
function clutterOf(band: Band, distance: Float32Array): number {
  const { bare, row } = band;
  const { left, top, right, bottom } = cellsOf(bare, row);
  let edges = 0;
  let cells = 0;
  for (let y = top; y < bottom; y += 1)
    for (let x = left; x < right; x += 1) {
      const p = y * bare.width + x;
      if ((distance[p] ?? Number.POSITIVE_INFINITY) > NEAR) continue;
      const here = luma(bare, p);
      const step = Math.max(
        Math.abs(here - luma(bare, p + 1)),
        Math.abs(here - luma(bare, p + bare.width)),
      );
      cells += 1;
      if (step >= EDGE) edges += 1;
    }
  return Math.round((edges / Math.max(1, cells)) * 10_000) / 10_000;
}

/** Rules every look holds still under: a crumb's colour transition would photograph between two colours. */
const still = (rules: string) =>
  `nav.breadcrumbs, nav.breadcrumbs * { transition: none !important; ${rules} }`;
/** Ink of one colour and no shadow: where the glyphs are. */
const inked = (color: string) =>
  still(`color: ${color} !important; text-shadow: none !important; filter: none !important;`);
const LOOK_ID = "kb-head-band-look";

/** The grey of a look's marker pixel, at the clip's top left, one per look. */
const MARKS = [16, 80, 144, 208] as const;

/** The grey at the top left pixel of a PNG (base64), decoded by the page's canvas. */
async function markIn(png: string): Promise<number> {
  const image = new Image();
  image.src = `data:image/png;base64,${png}`;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const pen = canvas.getContext("2d", { willReadFrequently: true });
  if (pen === null) return -1;
  pen.drawImage(image, 0, 0);
  return pen.getImageData(0, 0, 1, 1).data[0] ?? -1;
}

/**
 * The clip photographed under `css`, once it holds still. The look also
 * paints a marker pixel of grey `mark` at the clip's top left, outside
 * every measured row. A shot counts once it holds that grey and is the same
 * as the shot before it: a layer can still show the look before (its tiles
 * are drawn apart from the frame that carries the marker), so a shot is
 * asked again until the whole frame has moved and settled.
 */
async function shotUnder(page: Page, clip: Box, css: string, mark: number): Promise<string> {
  const marker = `body::after { content: ""; position: fixed; left: 0; top: 0; width: 2px; height: 2px; z-index: 2147483647; background: rgb(${mark} ${mark} ${mark}); }`;
  await page.evaluate(
    ({ id, rules }) => {
      const style = document.createElement("style");
      style.id = id;
      style.textContent = rules;
      document.head.append(style);
    },
    { id: LOOK_ID, rules: `${css}\n${marker}` },
  );
  let png = "";
  await expect
    .poll(
      async () => {
        const last = png;
        png = (await page.screenshot({ clip })).toString("base64");
        return png === last && Math.abs((await page.evaluate(markIn, png)) - mark) <= 2;
      },
      {
        message: `the look marked ${mark} never held still`,
        intervals: [50, 100, 250],
        timeout: SETTLE,
      },
    )
    .toBe(true);
  await page.evaluate((id) => document.getElementById(id)?.remove(), LOOK_ID);
  return png;
}

/** The page's ground, `--background`, in sRGB 0–255. */
function pageGround(): number[] {
  const pen = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  if (pen === null) return [0, 0, 0];
  pen.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--background");
  pen.fillRect(0, 0, 1, 1);
  return Array.from(pen.getImageData(0, 0, 1, 1).data.slice(0, 3));
}

/** The band on this page as drawn now, in its four looks. */
async function bandOf(page: Page): Promise<Band> {
  const crumbs = await page.evaluate(crumbsShown);
  expect(crumbs.length, "no breadcrumbs").toBeGreaterThan(0);
  const row = await page.locator("nav.breadcrumbs").evaluate((nav) => {
    const { x, y, width, height } = nav.getBoundingClientRect();
    return { x, y, width, height };
  });
  const bottom = Math.max(row.y + row.height, ...crumbs.map(({ y, height }) => y + height));
  const clip = { x: 0, y: 0, width: 1280, height: bottom + 8 };
  const pngs = [
    // A transparent text paints no shadow: the ink is all but transparent, so the halo stays.
    await shotUnder(page, clip, still("color: rgb(128 128 128 / 0.005) !important;"), MARKS[0]),
    await shotUnder(page, clip, inked("#000"), MARKS[1]),
    await shotUnder(page, clip, inked("#fff"), MARKS[2]),
    await shotUnder(page, clip, "[data-head-band] { visibility: hidden !important; }", MARKS[3]),
  ];
  const [ground, black, white, bare] = (await page.evaluate(decodedInPage, pngs)).map(
    ({ width, height, rgba }) => ({
      width,
      height,
      rgba: new Uint8Array(Buffer.from(rgba, "base64")),
    }),
  );
  if (ground === undefined || black === undefined || white === undefined || bare === undefined)
    throw new Error("a shot did not decode");
  return { crumbs, row, page: await page.evaluate(pageGround), ground, black, white, bare };
}

/** What the band on this page breaks as drawn now, one line each. */
async function unreadable(page: Page, label: string): Promise<string[]> {
  const band = await bandOf(page);
  const glyph = glyphsOf(band);
  const distance = distanceTo(glyph, band.ground.width);
  const failures = band.crumbs
    .map((crumb) => ({ text: crumb.text, ratio: inkContrast(band, glyph, crumb) }))
    .filter(({ ratio }) => ratio < AA)
    .map(({ text, ratio }) => `${label}: "${text}" at ${ratio}:1`);
  const backing = backingOf(band, distance);
  if (backing.near - backing.far > BACKING)
    failures.push(
      `${label}: a backing behind the breadcrumbs (${backing.near} near, ${backing.far} far)`,
    );
  const clutter = clutterOf(band, distance);
  if (clutter > CLEAR)
    failures.push(
      `${label}: the backdrop's art crosses the breadcrumbs (${clutter} of their glyphs on an edge)`,
    );
  return failures;
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
              timeout: SETTLE,
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
