import { describe, expect, test } from "vitest";
import { LONG_PRESS_MS, POINTER_SLOPS } from "@kb/ui-sdk";
import { TouchGestures, type TouchHost } from "./canvas-touch";

/** A host that writes down what it is asked, with a clock the test turns by hand. */
function rig() {
  const log: string[] = [];
  const view = { x: 0, y: 0, zoom: 1 };
  const timers = new Set<{ at: number; act: () => void }>();
  let now = 0;
  const host: TouchHost = {
    cancel: (id) => log.push(`cancel ${id}`),
    panBy: (dx, dy) => {
      view.x += dx;
      view.y += dy;
    },
    zoomAt: (factor, at) => {
      view.zoom *= factor;
      log.push(`zoom ${factor.toFixed(2)} @${at.x},${at.y}`);
    },
    settle: () => log.push("settle"),
    menu: (at) => log.push(`menu @${at.x},${at.y}`),
    after: (ms, act) => {
      const timer = { at: now + ms, act };
      timers.add(timer);
      return () => timers.delete(timer);
    },
  };
  const wait = (ms: number) => {
    now += ms;
    for (const timer of timers) {
      if (timer.at > now) continue;
      timers.delete(timer);
      timer.act();
    }
  };
  return { gestures: new TouchGestures(host), log, view, wait };
}

describe("one finger", () => {
  test("is a press the projection has: nothing is owned and the camera stays", () => {
    const { gestures, log, view } = rig();
    expect(gestures.down(1, { x: 100, y: 100 })).toBe(false);
    expect(gestures.move(1, { x: 160, y: 120 })).toBe(false);
    expect(gestures.up(1)).toBe(false);
    expect(gestures.active).toBe(false);
    expect(view).toEqual({ x: 0, y: 0, zoom: 1 });
    expect(log).toEqual([]);
  });

  test("held still for the long-press time opens the menu where it is, its press cancelled", () => {
    const { gestures, log, wait } = rig();
    gestures.down(1, { x: 100, y: 100 });
    // A finger trembles inside the touch slop and is still held still.
    gestures.move(1, { x: 100 + POINTER_SLOPS.touch - 1, y: 100 });
    wait(LONG_PRESS_MS - 1);
    expect(log).toEqual([]);
    wait(1);
    expect(log).toEqual(["cancel 1", `menu @${100 + POINTER_SLOPS.touch - 1},100`]);
    // The finger is the menu's until it lifts: no move or release reaches the projection.
    expect(gestures.move(1, { x: 300, y: 300 })).toBe(true);
    expect(gestures.up(1)).toBe(true);
    expect(gestures.active).toBe(false);
  });

  test("moved past the touch slop is a drag, never a long press", () => {
    const { gestures, log, wait } = rig();
    gestures.down(1, { x: 100, y: 100 });
    gestures.move(1, { x: 100 + POINTER_SLOPS.touch + 1, y: 100 });
    wait(LONG_PRESS_MS * 2);
    expect(log).toEqual([]);
  });

  test("lifted before the long-press time is a tap", () => {
    const { gestures, log, wait } = rig();
    gestures.down(1, { x: 100, y: 100 });
    gestures.up(1);
    wait(LONG_PRESS_MS * 2);
    expect(log).toEqual([]);
  });
});

describe("two fingers", () => {
  test("take the touch from the projection: the first finger's press is cancelled", () => {
    const { gestures, log, wait } = rig();
    gestures.down(1, { x: 100, y: 100 });
    expect(gestures.down(2, { x: 200, y: 100 })).toBe(true);
    expect(log).toEqual(["cancel 1"]);
    // Neither is a long press now.
    wait(LONG_PRESS_MS * 2);
    expect(log).toEqual(["cancel 1"]);
  });

  test("moved together pan the view by their midpoint's travel", () => {
    const { gestures, view } = rig();
    gestures.down(1, { x: 100, y: 100 });
    gestures.down(2, { x: 200, y: 100 });
    expect(gestures.move(1, { x: 130, y: 140 })).toBe(true);
    expect(gestures.move(2, { x: 230, y: 140 })).toBe(true);
    expect(view.x).toBeCloseTo(30);
    expect(view.y).toBeCloseTo(40);
    expect(view.zoom).toBeCloseTo(1);
  });

  test("spread apart zoom by how far they spread, about their midpoint", () => {
    const { gestures, log, view } = rig();
    gestures.down(1, { x: 100, y: 100 });
    gestures.down(2, { x: 200, y: 100 });
    gestures.move(2, { x: 300, y: 100 });
    // From 100 apart to 200: twice the zoom, about the new midpoint.
    expect(view.zoom).toBeCloseTo(2);
    expect(log).toContain("zoom 2.00 @200,100");
    gestures.move(1, { x: 200, y: 100 });
    // Pinched back to 100 apart: where it began.
    expect(view.zoom).toBeCloseTo(1);
  });

  test("the view comes to rest when the last finger lifts; one left pans alone", () => {
    const { gestures, log, view } = rig();
    gestures.down(1, { x: 100, y: 100 });
    gestures.down(2, { x: 200, y: 100 });
    gestures.move(2, { x: 220, y: 100 });
    expect(gestures.up(2)).toBe(true);
    expect(log).not.toContain("settle");
    const zoom = view.zoom;
    const x = view.x;
    expect(gestures.move(1, { x: 150, y: 100 })).toBe(true);
    expect(view.x).toBeCloseTo(x + 50);
    expect(view.zoom).toBe(zoom);
    expect(gestures.up(1)).toBe(true);
    expect(log.at(-1)).toBe("settle");
    expect(gestures.active).toBe(false);
  });

  test("put down and lifted without moving leave the view unsettled: nothing to save", () => {
    const { gestures, log } = rig();
    gestures.down(1, { x: 100, y: 100 });
    gestures.down(2, { x: 200, y: 100 });
    gestures.up(1);
    gestures.up(2);
    expect(log).toEqual(["cancel 1"]);
  });

  test("a third finger joins the gesture", () => {
    const { gestures } = rig();
    gestures.down(1, { x: 100, y: 100 });
    gestures.down(2, { x: 200, y: 100 });
    expect(gestures.down(3, { x: 150, y: 200 })).toBe(true);
    expect(gestures.move(3, { x: 150, y: 220 })).toBe(true);
  });
});
