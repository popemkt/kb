/**
 * A placing tool's draft through the pointer reducer (`draft/start`): a
 * click places its preset, a drag draws its item out, and an arrow drawn
 * from one item to another is the edge between them.
 */
import { describe, expect, test } from "vitest";
import {
  canvasMembership,
  type CanvasDoc,
  type CanvasNode,
  type CanvasPresetKind,
} from "@kb/canvas";
import { EMPTY_SELECTION } from "./canvas-selection";
import { viewOfPan } from "./canvas-camera";
import { createPointerState, pointerReduce, type PointerContext } from "./canvas-pointer";

const a: CanvasNode = { id: "a", type: "shape", shape: "rect", x: 0, y: 0, width: 100, height: 60 };
const b: CanvasNode = {
  id: "b",
  type: "shape",
  shape: "rect",
  x: 300,
  y: 0,
  width: 100,
  height: 60,
};
const doc: CanvasDoc = { nodes: [a, b], edges: [] };
const size = { width: 800, height: 600 };
/** The top view with no pan at 1:1: a screen point is the canvas point it stands over. */
const top = viewOfPan({ x: 0, y: 0 }, 1, size);

function context(stateDoc: CanvasDoc): PointerContext {
  return {
    doc: stateDoc,
    membership: canvasMembership(stateDoc.nodes),
    scope: null,
    selection: EMPTY_SELECTION,
    byId: new Map(stateDoc.nodes.map((node) => [node.id, node])),
    view: top,
    size,
  };
}

/** A draft of `preset` pressed at the first point and let go at the last, through the rest. */
function draft(
  preset: CanvasPresetKind,
  screens: readonly { x: number; y: number }[],
  on: string | null = null,
  shiftKey = false,
) {
  const [first = { x: 0, y: 0 }, ...rest] = screens;
  let ctx = context(doc);
  let step = pointerReduce(
    createPointerState(),
    {
      type: "draft/start",
      id: "d",
      preset,
      at: first,
      on,
      screen: first,
      edgeId: "e",
      bindingId: "k",
    },
    ctx,
  );
  const persists: (string | undefined)[] = [];
  for (const screen of rest.slice(0, -1)) {
    step = pointerReduce(step.state, { type: "pointer/move", screen, shiftKey }, ctx);
    persists.push(step.persist);
    ctx = context(step.doc ?? ctx.doc);
  }
  const end = pointerReduce(
    step.state,
    { type: "pointer/end", screen: rest.at(-1) ?? first, shiftKey },
    ctx,
  );
  return { end, persists };
}

describe("a draft", () => {
  test("a click places the preset at its own size, centred where it was pressed, selected", () => {
    const { end } = draft("rect", [
      { x: 500, y: 300 },
      { x: 501, y: 300 },
    ]);
    expect(end.persist).toBe("history");
    expect(end.doc?.nodes.at(-1)).toMatchObject({
      id: "d",
      x: 420,
      y: 250,
      width: 160,
      height: 100,
    });
    expect([...(end.selection?.nodeIds ?? [])]).toEqual(["d"]);
    expect(end.edit).toBeUndefined();
  });

  test("a drag previews its item as it goes, then writes the box it drew as one history step", () => {
    const { end, persists } = draft("ellipse", [
      { x: 500, y: 300 },
      { x: 540, y: 330 },
      { x: 600, y: 380 },
      { x: 600, y: 380 },
    ]);
    expect(persists).toEqual(["silent", "silent"]);
    expect(end.persist).toBe("history");
    expect(end.doc?.nodes.filter((n) => n.id === "d")).toEqual([
      expect.objectContaining({ x: 500, y: 300, width: 100, height: 80 }),
    ]);
  });

  test("a text card drawn out is opened for typing", () => {
    const { end } = draft("text", [
      { x: 500, y: 300 },
      { x: 700, y: 400 },
      { x: 700, y: 400 },
    ]);
    expect(end.edit).toBe("d");
  });

  test("an arrow drawn from one item onto another is the edge between them, facing each other", () => {
    const { end } = draft(
      "arrow",
      [
        { x: 50, y: 30 },
        { x: 200, y: 30 },
        { x: 350, y: 30 },
      ],
      "a",
    );
    expect(end.persist).toBe("flush");
    expect(end.doc?.nodes.map((n) => n.id)).toEqual(["a", "b"]);
    expect(end.doc?.edges).toEqual([
      expect.objectContaining({
        id: "e",
        fromNode: "a",
        toNode: "b",
        fromSide: "right",
        toSide: "left",
      }),
    ]);
    expect([...(end.selection?.edgeIds ?? [])]).toEqual(["e"]);
  });

  test("an arrow let go on empty canvas is a free arrow from the press; back on its own item it draws nothing", () => {
    const empty = draft(
      "arrow",
      [
        { x: 50, y: 30 },
        { x: 200, y: 200 },
        { x: 250, y: 230 },
      ],
      "a",
    ).end;
    expect(empty.doc?.edges).toEqual([]);
    expect(empty.doc?.nodes.at(-1)).toMatchObject({
      id: "d",
      type: "path",
      x: 50,
      y: 30,
      toHead: "arrow",
    });
    const back = draft(
      "arrow",
      [
        { x: 50, y: 30 },
        { x: 70, y: 40 },
        { x: 80, y: 40 },
      ],
      "a",
    ).end;
    // A stub lying on the item it came from would bind nothing: none is made.
    expect(back.persist).toBe("cancel");
    expect(back.doc).toBeUndefined();
  });

  test("click or drag is read where it is let go: far from the press with no move between, it draws", () => {
    const { end } = draft("rect", [
      { x: 500, y: 300 },
      { x: 620, y: 380 },
    ]);
    expect(end.doc?.nodes.at(-1)).toMatchObject({ x: 500, y: 300, width: 120, height: 80 });
  });

  test("a drag too short to draw places the preset, and a thin one is drawn at least MIN_DRAFT across", () => {
    const short = draft("rect", [
      { x: 500, y: 300 },
      { x: 510, y: 300 },
      { x: 504, y: 303 },
    ]).end;
    expect(short.doc?.nodes.at(-1)).toMatchObject({ x: 420, y: 250, width: 160, height: 100 });
    const thin = draft("rect", [
      { x: 500, y: 300 },
      { x: 600, y: 300 },
      { x: 600, y: 301 },
    ]).end;
    expect(thin.doc?.nodes.at(-1)).toMatchObject({ x: 500, y: 300, width: 100, height: 8 });
  });

  test("an arrow clicked on an item draws nothing", () => {
    const { end } = draft(
      "arrow",
      [
        { x: 50, y: 30 },
        { x: 50, y: 30 },
      ],
      "a",
    );
    expect(end.persist).toBe("cancel");
    expect(end.doc).toBeUndefined();
  });
});
