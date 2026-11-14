// Deliberately .e2e.ts: Bun's recursive unit-test discovery must not load it.
//
// A row's drag (DESIGN-UI.md → Outline editor, "A row moves anywhere"), end
// to end in a browser: a press on a bullet that travels picks the row up, a
// ghost follows the pointer and a line shows where it lands; the drop moves
// it there as one write the server stores, one undo putting it back. Past a
// row's text start it lands as that row's child; a range goes together;
// Escape puts it down; a finger drags as a mouse does; the page scrolls
// near its edges.
import type { APIRequestContext, Locator, Page } from "playwright/test";
import { expect, test } from "./harness-test.ts";

const ROOT = "render.fixture.root";

/** Run kb action `id` over the API, and answer its output. */
async function invoke<T>(request: APIRequestContext, id: string, input: unknown): Promise<T> {
  const response = await request.post("/api/action", { data: { id, input } });
  const receipt = (await response.json()) as { status: string; message?: string; output?: T };
  expect(receipt.status, receipt.message).toBe("succeeded");
  if (receipt.output === undefined) throw new Error(`${id} answered nothing`);
  return receipt.output;
}

const add = async (request: APIRequestContext, text: string): Promise<string> =>
  (await invoke<{ id: string }>(request, "node.add", { text, parent: ROOT })).id;

/** The ids of the children of `id`, in order, as the store holds them. */
async function childrenOf(request: APIRequestContext, id: string): Promise<string[]> {
  const { node } = await invoke<{ node: { children?: { id: string }[] } }>(request, "node.get", {
    id,
    depth: 1,
  });
  return (node.children ?? []).map((child) => child.id);
}

/** The order `ids` stand in under the root, as the store holds them. */
const orderOf = async (request: APIRequestContext, ids: readonly string[]) =>
  (await childrenOf(request, ROOT)).filter((id) => ids.includes(id));

const row = (page: Page, id: string) =>
  page.locator(`[data-node-row="true"][data-node-id="${id}"]`);

const bullet = (page: Page, id: string) => row(page, id).locator(".bullet-container");

/** The centre of `locator`, on screen. */
async function centre(locator: Locator): Promise<{ x: number; y: number }> {
  const box = await locator.boundingBox();
  if (box === null) throw new Error("not on screen");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** A point on row `id`: `dy` px from its top, `dx` px from its text start. */
async function onRow(page: Page, id: string, dx: number, dy: number) {
  const text = await row(page, id).locator(".node-content").boundingBox();
  const box = await row(page, id).boundingBox();
  if (text === null || box === null) throw new Error("not on screen");
  return { x: text.x + dx, y: box.y + dy };
}

type Point = { x: number; y: number };

/**
 * Press the bullet of `id` with the mouse and carry it to `to`, measured
 * once the bullet is on screen, still pressed.
 */
async function pickUp(page: Page, id: string, to: () => Promise<Point>): Promise<void> {
  await bullet(page, id).scrollIntoViewIfNeeded();
  const from = await centre(bullet(page, id));
  const at = await to();
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(at.x, at.y, { steps: 8 });
}

const ghost = (page: Page) => page.locator('[data-row-drag-ghost="true"]');
const line = (page: Page) => page.locator('[data-row-drop-line="true"]');

test.beforeEach(async ({ page }) => {
  // Tall enough that the rows stand clear of the edges a drag scrolls at.
  await page.setViewportSize({ width: 1280, height: 1400 });
  await page.emulateMedia({ reducedMotion: "reduce" });
});

test("a row dragged above another lands before it, where the line was, and one undo puts it back", async ({
  page,
  request,
}) => {
  const ids = [
    await add(request, "Alpha row"),
    await add(request, "Bravo row"),
    await add(request, "Charlie row"),
  ];
  const [alpha = "", , charlie = ""] = ids;
  await page.goto(`/node/${ROOT}`);
  await expect(row(page, charlie)).toBeVisible();

  await pickUp(page, charlie, () => onRow(page, alpha, -12, 4));
  await expect(ghost(page)).toContainText("Charlie row");
  await expect(line(page)).toBeVisible();
  // The line is on Alpha's top edge.
  const top = (await row(page, alpha).boundingBox())?.y ?? 0;
  const drawn = await line(page).boundingBox();
  expect(Math.abs((drawn?.y ?? 0) + (drawn?.height ?? 0) / 2 - top)).toBeLessThan(2);
  await page.mouse.up();

  await expect(ghost(page)).toHaveCount(0);
  await expect(line(page)).toHaveCount(0);
  await expect.poll(() => orderOf(request, ids)).toEqual([charlie, ...ids.slice(0, 2)]);
  // The row moved is the one selected, where it landed.
  await expect(row(page, charlie)).toHaveAttribute("aria-selected", "true");

  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => orderOf(request, ids)).toEqual(ids);
});

test("past a row's text start, a row lands as its first child, the row opening to show it", async ({
  page,
  request,
}) => {
  const moving = await add(request, "Row to file away");
  const shelf = await add(request, "Shelf row");
  await page.goto(`/node/${ROOT}`);
  // A child the shelf gains in view keeps it open (a row with children opens
  // closed only when it had them when the page loaded).
  await expect(row(page, shelf)).toBeVisible();
  const kept = await invoke<{ id: string }>(request, "node.add", {
    text: "Already on the shelf",
    parent: shelf,
  });
  await expect(row(page, kept.id)).toBeVisible();
  // The shelf collapsed: its children not drawn.
  await bullet(page, shelf).click();
  await expect(row(page, kept.id)).toHaveCount(0);

  await pickUp(page, moving, () => onRow(page, shelf, 40, 20));
  await expect(line(page)).toBeVisible();
  await page.mouse.up();

  await expect.poll(() => childrenOf(request, shelf)).toEqual([moving, kept.id]);
  await expect(row(page, moving)).toBeVisible();
  await expect(row(page, kept.id)).toBeVisible();
});

test("Escape puts a dragged row down where it was, and its press is not a click", async ({
  page,
  request,
}) => {
  const ids = [await add(request, "Stays first"), await add(request, "Stays second")];
  const [first = "", second = ""] = ids;
  await page.goto(`/node/${ROOT}`);
  // A child the row gains in view keeps it open, its child drawn.
  await expect(row(page, second)).toBeVisible();
  const child = await invoke<{ id: string }>(request, "node.add", {
    text: "A child of the second",
    parent: second,
  });
  await expect(row(page, child.id)).toBeVisible();

  await pickUp(page, second, () => onRow(page, first, -12, 4));
  await expect(line(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(ghost(page)).toHaveCount(0);
  await page.mouse.up();

  await expect.poll(() => orderOf(request, ids)).toEqual(ids);
  // The bullet's click (collapse) was not made: its child is still drawn.
  await expect(row(page, child.id)).toBeVisible();
  // A click that does not travel is still a click.
  await bullet(page, second).click();
  await expect(row(page, child.id)).toHaveCount(0);
});

test("a range of rows dragged goes together, in order", async ({ page, request }) => {
  const ids = [
    await add(request, "Range one"),
    await add(request, "Range two"),
    await add(request, "Range end"),
  ];
  const [one = "", two = "", end = ""] = ids;
  await page.goto(`/node/${ROOT}`);
  await row(page, one).locator(".node-content").click();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Shift+ArrowDown");
  await expect(row(page, two)).toHaveAttribute("aria-selected", "true");

  await pickUp(page, two, () => onRow(page, end, -12, 20));
  await expect(ghost(page)).toContainText("+1");
  await page.mouse.up();

  await expect.poll(() => orderOf(request, ids)).toEqual([end, one, two]);
  for (const id of [one, two]) {
    await expect(row(page, id)).toHaveAttribute("aria-selected", "true");
  }
});

test("a finger drags a row as a mouse does", async ({ page, request }) => {
  const ids = [await add(request, "Touched first"), await add(request, "Touched last")];
  const [first = "", last = ""] = ids;
  await page.goto(`/node/${ROOT}`);
  await expect(row(page, last)).toBeVisible();

  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
  await bullet(page, last).scrollIntoViewIfNeeded();
  const from = await centre(bullet(page, last));
  const to = await onRow(page, first, -12, 4);
  const touch = (
    type: "touchStart" | "touchMove" | "touchEnd",
    points: { x: number; y: number }[],
  ) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points });
  await touch("touchStart", [from]);
  for (let i = 1; i <= 8; i += 1) {
    await touch("touchMove", [
      { x: from.x + ((to.x - from.x) * i) / 8, y: from.y + ((to.y - from.y) * i) / 8 },
    ]);
  }
  await expect(ghost(page)).toContainText("Touched last");
  await touch("touchEnd", []);

  await expect.poll(() => orderOf(request, ids)).toEqual([last, first]);
});

test("near the bottom of the page, a drag scrolls it", async ({ page, request }) => {
  await page.setViewportSize({ width: 900, height: 480 });
  const first = await add(request, "Row 0");
  for (let i = 1; i < 40; i += 1) await add(request, `Row ${i}`);
  await page.goto(`/node/${ROOT}`);
  await expect(row(page, first)).toBeVisible();

  /** How far the outline's scroller has scrolled. */
  const scrolled = () =>
    row(page, first).evaluate((el) => {
      for (let at = el.parentElement; at !== null; at = at.parentElement) {
        const { overflowY } = getComputedStyle(at);
        if ((overflowY === "auto" || overflowY === "scroll") && at.scrollHeight > at.clientHeight) {
          return at.scrollTop;
        }
      }
      return document.scrollingElement?.scrollTop ?? 0;
    });
  await bullet(page, first).scrollIntoViewIfNeeded();
  const before = await scrolled();
  const from = await centre(bullet(page, first));
  await pickUp(page, first, () => Promise.resolve({ x: from.x, y: 470 }));
  await expect.poll(scrolled).toBeGreaterThan(before);
  await page.keyboard.press("Escape");
  await page.mouse.up();
});
