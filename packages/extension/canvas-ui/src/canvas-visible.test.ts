import { describe, expect, it } from "vitest";
import { edgeRoute, routePoints, type CanvasDoc, type CanvasNode } from "@kb/canvas";
import { projectPoint, screenBounds, viewOfPan } from "./canvas-camera";
import {
  anchorFrame,
  anchorRects,
  edgeScreenLines,
  itemUnder,
  placeBeside,
  visibleItemIds,
} from "./canvas-visible";

function item(id: string, x: number, y: number, width = 100, height = 50): CanvasNode {
  return { id, type: "text", text: id, x, y, width, height };
}

const size = { width: 400, height: 300 };
/** The 2D camera of a CSS pan and zoom on that stage. */
const flat = (pan: { x: number; y: number }, zoom: number) => viewOfPan(pan, zoom, size);

describe("visibleItemIds", () => {
  const items = [item("a", 0, 0), item("b", 500, 0), item("c", -150, -80)];

  it("keeps the items that reach into the stage, in document order", () => {
    expect(visibleItemIds(items, flat({ x: 0, y: 0 }, 1), size)).toEqual(["a"]);
  });

  it("follows the pan and the zoom", () => {
    // Panned right by 200px: canvas x from -200 to 200 is on screen.
    expect(visibleItemIds(items, flat({ x: 200, y: 100 }, 1), size)).toEqual(["a", "c"]);
    // Zoomed out to a half: canvas 0..800 wide is on screen.
    expect(visibleItemIds(items, flat({ x: 0, y: 0 }, 0.5), size)).toEqual(["a", "b"]);
  });

  it("in perspective, sees what is in front of the eye and inside the frame", () => {
    const view = { x: 50, y: 25, z: 0, zoom: 1, yaw: 0, pitch: 0, fov: 40 };
    const behind = { ...item("behind", 0, 0), z: 1e6 };
    const far = item("far", 4000, 0);
    expect(visibleItemIds([items[0] as CanvasNode, behind, far], view, size)).toEqual(["a"]);
    expect(screenBounds(view, size, behind)).toBeNull();
    // Tipped toward level, a long item runs from in front of the eye to behind it.
    const tipped = { ...view, pitch: 1.2 };
    const across = item("across", 0, -1000, 100, 1e6);
    const drawn = screenBounds(tipped, size, across);
    expect(drawn).not.toBeNull();
    expect(Number.isFinite(drawn?.bottom)).toBe(true);
    expect(visibleItemIds([across], tipped, size)).toEqual(["across"]);
  });

  it("sees nothing through a stage with no size", () => {
    expect(visibleItemIds(items, flat({ x: 0, y: 0 }, 1), { width: 0, height: 0 })).toEqual([]);
  });
});

describe("edgeScreenLines", () => {
  const doc: CanvasDoc = {
    nodes: [item("a", 0, 0), item("b", 300, 120)],
    edges: [
      { id: "e", fromNode: "a", toNode: "b" },
      { id: "gone", fromNode: "a", toNode: "nowhere" },
    ],
  };

  it("is each edge's route projected through the camera; an edge with an end gone has none", () => {
    for (const view of [
      flat({ x: 40, y: 30 }, 1.5),
      { x: 200, y: 80, z: 0, zoom: 0.8, yaw: 0.7, pitch: 0.9, fov: 34 },
    ]) {
      const [a, b] = doc.nodes;
      const edge = doc.edges[0];
      if (a === undefined || b === undefined || edge === undefined) throw new Error("no doc");
      const model = routePoints(edgeRoute(a, b, edge)).map((p) => projectPoint(view, size, p));
      expect(edgeScreenLines(doc, view, size)).toEqual([{ id: "e", points: model }]);
    }
  });
});

describe("comment targets", () => {
  const doc: CanvasDoc = {
    nodes: [item("frame", 0, 0, 300, 200), item("in", 20, 20, 50, 30)],
    edges: [],
  };
  const view = flat({ x: 0, y: 0 }, 1);

  it("draws an item thread on its item's box and a point thread on its point", () => {
    expect(anchorRects({ item: "in" }, doc, view, size)).toEqual([
      { item: "in", rect: { left: 20, top: 20, right: 70, bottom: 50 } },
    ]);
    expect(anchorRects({ at: { x: 5, y: 6 } }, doc, view, size)).toEqual([
      { item: null, rect: { left: 5, top: 6, right: 5, bottom: 6 } },
    ]);
    expect(anchorRects({ item: "gone" }, doc, view, size)).toEqual([]);
    expect(anchorRects(null, doc, view, size)).toEqual([]);
  });

  it("frames an item thread on its items, a point thread on the floor about it at the zoom it has", () => {
    expect(anchorFrame({ item: "in" }, doc, view, size).map(({ id }) => id)).toEqual(["in"]);
    expect(anchorFrame({ at: { x: 100, y: 50 } }, doc, flat({ x: 0, y: 0 }, 2), size)).toEqual([
      { id: "", x: 0, y: -25, width: 200, height: 150 },
    ]);
  });

  it("finds the smallest item under a point, so a member wins over its frame", () => {
    expect(itemUnder(doc.nodes, view, size, { x: 30, y: 30 })).toBe("in");
    expect(itemUnder(doc.nodes, view, size, { x: 200, y: 150 })).toBe("frame");
    expect(itemUnder(doc.nodes, view, size, { x: 350, y: 250 })).toBeNull();
  });
});

const box = (left: number, top: number, right: number, bottom: number) => ({
  left,
  top,
  right,
  bottom,
});

describe("placeBeside", () => {
  const stage = { width: 1000, height: 600 };
  const panel = { width: 200, height: 150 };

  it("stands right of the target, else left, else under, else over: never over it", () => {
    expect(placeBeside([box(100, 100, 200, 160)], panel, stage, 200)).toEqual({ x: 212, y: 100 });
    // No room right of it short of the dock: left of it.
    expect(placeBeside([box(500, 100, 700, 160)], panel, stage, 200)).toEqual({ x: 288, y: 100 });
    // As wide as the room: under it, then over it.
    expect(placeBeside([box(12, 100, 788, 160)], panel, stage, 200)).toEqual({ x: 12, y: 172 });
    expect(placeBeside([box(12, 300, 788, 500)], panel, stage, 200)).toEqual({ x: 12, y: 138 });
  });

  it("keeps inside the stage, and stands in its middle for a target nowhere drawn", () => {
    expect(placeBeside([box(100, 550, 200, 560)], panel, stage, 200)).toEqual({ x: 212, y: 438 });
    expect(placeBeside([], panel, stage, 200)).toEqual({ x: 294, y: 225 });
  });
});
