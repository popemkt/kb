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
});
