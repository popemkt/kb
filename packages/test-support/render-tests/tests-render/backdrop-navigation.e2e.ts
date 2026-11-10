// Deliberately .e2e.ts: Bun's recursive unit-test discovery must not load it.
//
// One backdrop across pages (DESIGN-UI.md → Page-head backdrops → One
// backdrop across pages): the pane's host draws a page head's backdrop above
// the router, so moving between pages never mounts it again. Over 20 moves
// in the page (the outline's home, a node's page and a tag's page, which
// stand in different scroll regions), a GPU backdrop keeps its one canvas
// and its one context, its clock only moves forward, and no GPU context is
// made after the first. A page that chooses another backdrop crossfades to
// it, and under reduced motion swaps at once; either way only one canvas is
// left once it has.
import { SYSTEM_IDS, backdropOptionId } from "@kb/model";
import type { APIRequestContext, Page } from "playwright/test";
import { expect, test } from "./harness-test.ts";

const CORE = "sys.extension.core";
const ROOT = "render.fixture.root";
const TAG = "render.fixture.tag";
const OWN = "navigation.own";
const LENS = "backdrops.lens";
const BLACK_HOLE = "backdrops.black-hole";
const FRAME = ".kb-header-backdrop-space .kb-header-backdrop";

const ref = (v: string) => ({ t: "ref", v });

async function action(request: APIRequestContext, id: string, input: Record<string, unknown>) {
  const response = await request.post("/api/action", { data: { id, input } });
  const receipt = await response.json();
  expect(receipt.status, JSON.stringify(receipt)).toBe("succeeded");
}

/** Counts every GPU context the page makes, from the first script on. */
function countContexts() {
  const made = { contexts: 0 };
  Object.assign(window, { kbContexts: made });
  // oxlint-disable-next-line typescript/unbound-method -- wrapped, and called with each canvas as `this`
  const getContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (
    this: HTMLCanvasElement,
    kind: string,
    options?: unknown,
  ) {
    const context = getContext.call(this, kind, options);
    if (context !== null && (kind === "webgpu" || kind.startsWith("webgl"))) made.contexts += 1;
    return context;
  } as typeof getContext;
}

/** Move to `path` in the page, as the router does: no load. */
async function go(page: Page, path: string) {
  await page.evaluate((to) => {
    history.pushState({}, "", to);
    dispatchEvent(new PopStateEvent("popstate"));
  }, path);
}

/** The head's canvas, marked so a later look can tell whether it is the same element. */
const markCanvas = (page: Page) =>
  page.evaluate((frame) => {
    const canvas = document.querySelector(`${frame} canvas`);
    Object.assign(window, { kbCanvas: canvas });
    return canvas !== null;
  }, FRAME);

const sameCanvas = (page: Page) =>
  page.evaluate((frame) => {
    const marked = (window as { kbCanvas?: Element | null }).kbCanvas;
    return (
      marked !== undefined &&
      marked !== null &&
      document.querySelector(`${frame} canvas`) === marked
    );
  }, FRAME);

const contexts = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { kbContexts: { contexts: number } }).kbContexts.contexts,
  );

const clock = (page: Page) =>
  page.evaluate(
    (frame) => Number(document.querySelector<HTMLElement>(`${frame} canvas`)?.dataset.clock ?? NaN),
    FRAME,
  );

test.beforeEach(async ({ request }) => {
  await action(request, "node.update", {
    id: CORE,
    setProps: [{ field: SYSTEM_IDS.backdropField, value: ref(backdropOptionId(LENS)) }],
  });
  await action(request, "node.add", {
    id: OWN,
    text: "A page with a backdrop of its own",
    parent: ROOT,
    props: [{ field: SYSTEM_IDS.backdropField, value: ref(backdropOptionId(BLACK_HOLE)) }],
  });
});

test("moving between pages keeps the backdrop's canvas, context and clock", async ({
  page,
  harness,
}) => {
  test.setTimeout(120_000);
  await page.addInitScript(countContexts);
  await page.goto(`${harness.url}/`);
  await expect(page.locator(`${FRAME} [data-scene-state="ready"]`)).toBeAttached({
    timeout: 20_000,
  });
  expect(await markCanvas(page)).toBe(true);
  const made = await contexts(page);
  let last = await clock(page);
  const route = ["/node/" + ROOT, "/node/" + TAG, "/", "/node/" + TAG, "/node/" + ROOT];
  for (let move = 0; move < 20; move++) {
    const path = route[move % route.length] ?? "/";
    await go(page, path);
    await expect(page.locator(FRAME)).toHaveCount(1);
    await expect(page.locator(`${FRAME} [data-scene-state="ready"]`)).toBeAttached();
    await page.waitForTimeout(120);
    expect(await sameCanvas(page), `move ${move + 1} to ${path}`).toBe(true);
    const now = await clock(page);
    expect(now, `move ${move + 1}: the clock only moves forward`).toBeGreaterThanOrEqual(last);
    last = now;
  }
  expect(await contexts(page), "no GPU context made after the first").toBe(made);
  expect(await page.locator("[data-page-backdrop] canvas").count()).toBe(1);
});

test("a page that chooses another backdrop crossfades to it", async ({ page, harness }) => {
  test.setTimeout(120_000);
  await page.addInitScript(countContexts);
  await page.goto(`${harness.url}/node/${ROOT}`);
  await expect(page.locator(`${FRAME} [data-scene-state="ready"]`)).toBeAttached({
    timeout: 20_000,
  });
  await go(page, `/node/${OWN}`);
  // Both are drawn while the one shown fades out, as an animation of its opacity.
  const leaving = page.locator('[data-backdrop-layer="leaving"]');
  await expect(leaving).toHaveCount(1);
  expect(
    await leaving.evaluate((layer) => layer.getAnimations().some((a) => a.playState === "running")),
  ).toBe(true);
  await expect(
    page.locator(`[data-backdrop-layer="shown"] ${FRAME.split(" ")[1]}`),
  ).toHaveAttribute("data-backdrop", BLACK_HOLE);
  // Then the one it left is let go, its canvas with it (the page's own backdrop field shows its cards' too).
  await expect(leaving).toHaveCount(0);
  await expect(page.locator(`${FRAME} [data-scene-state="ready"]`)).toBeAttached({
    timeout: 20_000,
  });
  expect(await page.locator("[data-page-backdrop] canvas").count()).toBe(1);
});

test("under reduced motion, a page that chooses another backdrop swaps to it at once", async ({
  browser,
  harness,
}) => {
  test.setTimeout(120_000);
  const context = await browser.newContext({ reducedMotion: "reduce" });
  const page = await context.newPage();
  try {
    await page.goto(`${harness.url}/node/${ROOT}`);
    await expect(page.locator(`${FRAME} [data-scene-state]`)).not.toHaveAttribute(
      "data-scene-state",
      "loading",
      { timeout: 20_000 },
    );
    await go(page, `/node/${OWN}`);
    await expect(page.locator(FRAME)).toHaveAttribute("data-backdrop", BLACK_HOLE);
    expect(await page.locator('[data-backdrop-layer="leaving"]').count()).toBe(0);
    expect(await page.locator(FRAME).count()).toBe(1);
  } finally {
    await context.close();
  }
});
