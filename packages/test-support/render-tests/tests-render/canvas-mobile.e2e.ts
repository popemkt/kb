/**
 * The canvas on a phone (DESIGN-UI.md → Canvas → Touch; the design note
 * `docs/research/2026-10-28-canvas-mobile.md`): fingers, sent the way a
 * real screen's are (CDP `Input.dispatchTouchEvent`), over a phone-sized
 * page that has touch.
 */
import type { APIRequestContext, CDPSession, Page } from "playwright/test";
import { present } from "@kb/model";
import { expect, test } from "./harness-test.ts";

const CANVAS = "render.canvas.mobile";

/** Three items a phone's opening view shows. */
const DOC = {
  nodes: [
    {
      id: "note",
      type: "text",
      text: "A canvas for thinking",
      x: 20,
      y: 20,
      width: 240,
      height: 80,
    },
    {
      id: "reference",
      type: "kb-node",
      nodeId: "render.fixture.root",
      x: 20,
      y: 140,
      width: 240,
      height: 90,
    },
    {
      id: "idea",
      type: "shape",
      shape: "rect",
      label: "A connected idea",
      x: 60,
      y: 280,
      width: 200,
      height: 110,
    },
  ],
  edges: [],
};

/** A Pixel 7 held upright: the owner's phone. */
const PIXEL = { width: 412, height: 915 } as const;
const PHONE = { hasTouch: true, isMobile: true, deviceScaleFactor: 2 } as const;

interface Finger {
  readonly x: number;
  readonly y: number;
}

/**
 * Fingers on the glass, as CDP reports a touch screen's: each call is the
 * fingers down now, by id; a finger left out has lifted, and none lifts all.
 */
class Fingers {
  private readonly cdp: CDPSession;

  private constructor(cdp: CDPSession) {
    this.cdp = cdp;
  }

  static async on(page: Page): Promise<Fingers> {
    return new Fingers(await page.context().newCDPSession(page));
  }

  private down = 0;

  async touch(...fingers: Finger[]): Promise<void> {
    const touchPoints = fingers.map((finger, id) => ({ ...finger, id }));
    const type =
      fingers.length === 0 ? "touchEnd" : fingers.length > this.down ? "touchStart" : "touchMove";
    this.down = fingers.length;
    await this.cdp.send("Input.dispatchTouchEvent", { type, touchPoints });
  }

  /** Fingers moved from where `from` holds them to `to`, in `steps` frames. */
  async slide(from: readonly Finger[], to: readonly Finger[], steps = 8): Promise<void> {
    for (let step = 1; step <= steps; step += 1) {
      const t = step / steps;
      await this.touch(
        ...from.map((f, i) => {
          const end = present(to[i], "a finger to slide to");
          return { x: f.x + (end.x - f.x) * t, y: f.y + (end.y - f.y) * t };
        }),
      );
    }
  }

  async lift(): Promise<void> {
    await this.touch();
  }
}

async function openCanvas(page: Page, request: APIRequestContext) {
  const response = await request.post("/api/action", {
    data: {
      id: "node.add",
      input: {
        id: CANVAS,
        text: "Phone study",
        tags: ["sys.tag.canvas"],
        props: [{ field: "sys.f.canvas", value: { t: "str", v: JSON.stringify(DOC) } }],
      },
    },
  });
  expect((await response.json()).status).toBe("succeeded");
  await page.goto(`/canvas/${CANVAS}`);
  await expect(page.locator("[data-canvas-viewport]")).toBeVisible();
  await expect(cardOf(page, "idea")).toBeVisible();
}

/** The zoom the header reads, as a fraction. */
async function zoomOf(page: Page): Promise<number> {
  const text = await page.getByTitle("Zoom", { exact: true }).innerText();
  return Number.parseInt(text, 10) / 100;
}

/** An item's body, which the pointer takes. */
const cardOf = (page: Page, id: string) => page.locator(`[data-card-id="${id}"] .group\\/card`);

/** Where an item's body stands on the page. */
async function boxOf(page: Page, id: string) {
  return present(await cardOf(page, id).boundingBox(), `${id}'s box`);
}

const centre = (box: { x: number; y: number; width: number; height: number }) => ({
  x: box.x + box.width / 2,
  y: box.y + box.height / 2,
});

test.describe("fingers on the 2D canvas", () => {
  test.use({ viewport: PIXEL, ...PHONE });

  test("a pinch zooms about the fingers' midpoint and two fingers pan", async ({
    page,
    request,
  }) => {
    await openCanvas(page, request);
    const fingers = await Fingers.on(page);
    const idea = centre(await boxOf(page, "idea"));
    // Spread from 100 apart to 200, about the idea's middle: twice the zoom, the idea held still.
    const from = [
      { x: idea.x - 50, y: idea.y },
      { x: idea.x + 50, y: idea.y },
    ];
    await fingers.touch(...from);
    await fingers.slide(from, [
      { x: idea.x - 100, y: idea.y },
      { x: idea.x + 100, y: idea.y },
    ]);
    await fingers.lift();
    await expect.poll(() => zoomOf(page)).toBeCloseTo(2, 1);
    const held = centre(await boxOf(page, "idea"));
    expect(held.x).toBeCloseTo(idea.x, -1);
    expect(held.y).toBeCloseTo(idea.y, -1);

    // Two fingers moved together carry the canvas with them, the zoom kept.
    const before = await boxOf(page, "note");
    const pair = [
      { x: 150, y: 600 },
      { x: 250, y: 600 },
    ];
    await fingers.touch(...pair);
    await fingers.slide(
      pair,
      pair.map((f) => ({ x: f.x + 60, y: f.y + 40 })),
    );
    await fingers.lift();
    const after = await boxOf(page, "note");
    expect(after.x - before.x).toBeCloseTo(60, -1);
    expect(after.y - before.y).toBeCloseTo(40, -1);
    expect(await zoomOf(page)).toBeCloseTo(2, 1);
  });

  test("a tap selects a card without moving it, and a second finger takes the drag back", async ({
    page,
    request,
  }) => {
    await openCanvas(page, request);
    const fingers = await Fingers.on(page);
    const box = await boxOf(page, "idea");
    const at = centre(box);
    // A finger's tap wanders: inside the touch slop it is still a tap.
    await fingers.touch(at);
    await fingers.touch({ x: at.x + 6, y: at.y + 3 });
    await fingers.lift();
    await expect(page.locator('[data-card-id="idea"][data-selected]')).toHaveCount(1);
    expect(await boxOf(page, "idea")).toEqual(box);

    // A drag begun by one finger is undone when a second lands: it is a camera gesture now.
    await fingers.touch(at);
    await fingers.slide([at], [{ x: at.x + 40, y: at.y }], 4);
    const moved = await boxOf(page, "idea");
    expect(moved.x - box.x).toBeGreaterThan(20);
    await fingers.touch({ x: at.x + 40, y: at.y }, { x: at.x + 140, y: at.y });
    await fingers.lift();
    await expect.poll(async () => (await boxOf(page, "idea")).x).toBeCloseTo(box.x, 0);
  });

  test("a long press opens the context menu on what it is held over", async ({ page, request }) => {
    await openCanvas(page, request);
    const fingers = await Fingers.on(page);
    const at = centre(await boxOf(page, "note"));
    await fingers.touch(at);
    await page.waitForTimeout(700);
    const menu = page.getByTestId("canvas-context-menu");
    await expect(menu).toBeVisible();
    await fingers.lift();
    await expect(menu).toBeVisible();
    await expect(page.locator('[data-card-id="note"][data-selected]')).toHaveCount(1);
    await expect(menu.getByRole("menuitem", { name: /Delete/ })).toBeVisible();
  });

  test("a finger carries a card by its words; a second tap, or a double tap, opens them", async ({
    page,
    request,
  }) => {
    await openCanvas(page, request);
    const fingers = await Fingers.on(page);
    /** Whether `id`'s words are open for typing: the focus is in its editor. */
    const typingIn = (id: string) =>
      page.evaluate((card) => {
        const at = document.activeElement;
        const editor =
          at instanceof HTMLTextAreaElement ||
          at instanceof HTMLInputElement ||
          (at as HTMLElement | null)?.isContentEditable;
        return editor === true && at?.closest(`[data-card-id="${card}"]`) !== null;
      }, id);
    const tap = async (at: Finger) => {
      await fingers.touch(at);
      await fingers.lift();
    };
    const empty = { x: 360, y: 620 };
    // The text card's words fill it, as a shape's label does; the kb card's are its node's text.
    const words = {
      note: async () => centre(await boxOf(page, "note")),
      idea: async () => centre(await boxOf(page, "idea")),
      reference: async () =>
        centre(
          present(
            await page.locator('[data-card-id="reference"] .node-content').boundingBox(),
            "the kb card's text",
          ),
        ),
    };
    for (const [id, wordsOf] of Object.entries(words)) {
      await tap(empty);
      const box = await boxOf(page, id);
      const from = await wordsOf();
      await fingers.touch(from);
      await fingers.slide([from], [{ x: from.x + 50, y: from.y + 30 }], 6);
      await fingers.lift();
      await expect.poll(async () => (await boxOf(page, id)).x).toBeCloseTo(box.x + 50, -1);
      await expect(page.locator(`[data-card-id="${id}"][data-selected]`)).toHaveCount(1);
      expect(await typingIn(id)).toBe(false);

      // Selected, a tap opens its words.
      await tap(await wordsOf());
      await expect.poll(() => typingIn(id)).toBe(true);

      // From nothing selected, a double tap: the first selects, the second opens.
      await tap(empty);
      await expect.poll(() => typingIn(id)).toBe(false);
      const again = await wordsOf();
      await tap(again);
      expect(await typingIn(id)).toBe(false);
      await tap(again);
      await expect.poll(() => typingIn(id)).toBe(true);
    }
  });
});

/** A pinch from 100 px apart to 200, about `at`. */
async function pinchOut(fingers: Fingers, at: Finger): Promise<void> {
  const from = [
    { x: at.x - 50, y: at.y },
    { x: at.x + 50, y: at.y },
  ];
  await fingers.touch(...from);
  await fingers.slide(from, [
    { x: at.x - 100, y: at.y },
    { x: at.x + 100, y: at.y },
  ]);
  await fingers.lift();
}

test.describe("fingers on the 3D canvas", () => {
  test.use({ viewport: PIXEL, ...PHONE });

  test("a pinch zooms the scene as it does the top view, and the pose comes to rest", async ({
    page,
    request,
  }) => {
    await openCanvas(page, request);
    await page.getByRole("button", { name: "More tools" }).click();
    await page
      .getByTestId("canvas-tool-sheet")
      .getByRole("button", { name: "3D projection" })
      .click();
    await expect(page.getByTestId("canvas-3d")).toBeVisible();
    // The handover flies out to its pose; the header reads its zoom once it has arrived.
    await page.waitForTimeout(2000);
    const before = await zoomOf(page);
    const fingers = await Fingers.on(page);
    await pinchOut(fingers, { x: PIXEL.width / 2, y: PIXEL.height / 2 });
    await expect.poll(async () => (await zoomOf(page)) / before).toBeGreaterThan(1.5);
  });
});

/** The phones the compact stage is proved on, each held as it is named. */
const PHONES = [
  { name: "a Pixel 7 upright", viewport: PIXEL },
  { name: "a Pixel 7 on its side", viewport: { width: PIXEL.height, height: PIXEL.width } },
  { name: "an iPhone 14 upright", viewport: { width: 390, height: 844 } },
] as const;

for (const phone of PHONES) {
  test.describe(`the compact stage on ${phone.name}`, () => {
    test.use({ viewport: phone.viewport, ...PHONE });

    test("the tools stand in one row along the bottom, a finger's size, and nothing covers a card's middle", async ({
      page,
      request,
    }, testInfo) => {
      await openCanvas(page, request);
      const strip = page.getByTestId("canvas-toolbar");
      await expect(strip).toHaveAttribute("data-compact", "");
      const box = present(await strip.boundingBox(), "the strip's box");
      // One row, along the bottom, inside the screen.
      expect(box.height).toBeLessThan(64);
      expect(phone.viewport.height - (box.y + box.height)).toBeLessThan(24);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(phone.viewport.width);
      for (const button of await strip.getByRole("button").all()) {
        const hit = present(await button.boundingBox(), "a tool's box");
        expect(Math.min(hit.width, hit.height)).toBeGreaterThanOrEqual(40);
      }
      // The gizmo folds away, and Add node is the kb node tool's.
      await expect(page.getByTestId("canvas-view-widget").locator("svg")).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Add node" })).toHaveCount(0);
      // Every card whose middle the stage shows is pressed there, not the chrome over it.
      const stage = present(
        await page.locator("[data-canvas-viewport]").boundingBox(),
        "the stage's box",
      );
      for (const id of ["note", "reference", "idea"]) {
        const at = centre(await boxOf(page, id));
        if (at.y > stage.y + stage.height || at.x > stage.x + stage.width) continue;
        const under = await page.evaluate(
          ({ x, y }) =>
            document
              .elementFromPoint(x, y)
              ?.closest("[data-card-id]")
              ?.getAttribute("data-card-id"),
          at,
        );
        expect(under, `${id}'s middle is the card's`).toBe(id);
      }
      await page.screenshot({ path: testInfo.outputPath("compact.png") });
    });
  });
}

test.describe("the compact stage's chrome", () => {
  test.use({ viewport: PIXEL, ...PHONE });

  test("More holds the rest of the tools and the projections, and puts itself away on a pick", async ({
    page,
    request,
  }) => {
    await openCanvas(page, request);
    const more = page.getByRole("button", { name: "More tools" });
    const sheet = page.getByTestId("canvas-tool-sheet");
    await more.tap();
    await expect(sheet).toBeVisible();
    await expect(sheet.locator('[data-projection="3d"]')).toBeVisible();
    for (const tool of ["comment", "image", "kb-node", "box", "wall"]) {
      await expect(sheet.locator(`[data-tool="${tool}"]`)).toBeVisible();
    }
    await sheet.locator('[data-tool="highlight"]').tap();
    await expect(sheet).toHaveCount(0);
    await more.tap();
    await expect(sheet.locator('[data-tool="highlight"]')).toHaveAttribute("aria-pressed", "true");
  });

  test("the selection toolbar stands above the tools and says its commands with marks", async ({
    page,
    request,
  }) => {
    await openCanvas(page, request);
    await cardOf(page, "idea").tap();
    const bar = page.getByTestId("canvas-selection-bar");
    await expect(bar).toBeVisible();
    const barBox = present(await bar.boundingBox(), "the bar's box");
    const strip = present(
      await page.getByTestId("canvas-toolbar").boundingBox(),
      "the strip's box",
    );
    expect(barBox.y + barBox.height).toBeLessThanOrEqual(strip.y);
    expect(barBox.x).toBeGreaterThanOrEqual(0);
    expect(barBox.x + barBox.width).toBeLessThanOrEqual(PIXEL.width);
    await bar.getByRole("button", { name: "Delete" }).tap();
    await expect(cardOf(page, "idea")).toHaveCount(0);
  });

  test("the view menu offers full screen where the browser has it", async ({ page, request }) => {
    await openCanvas(page, request);
    await page.getByTestId("canvas-view-widget").getByRole("button").tap();
    const row = page.getByTestId("canvas-view-menu").getByRole("menuitemcheckbox", {
      name: "Full screen",
    });
    await expect(row).toBeVisible();
    await row.tap();
    await expect.poll(() => page.evaluate(() => document.fullscreenElement !== null)).toBe(true);
  });
});
