import { expect, test } from "vitest";
import { canvasMembership, type CanvasDoc } from "@kb/canvas";
import { POINTER_SLOPS, type PointerKind } from "@kb/ui-sdk";
import { viewOfPan } from "./canvas-camera";
import { createPointerState, pointerReduce, type PointerContext } from "./canvas-pointer";
import { selectNode } from "./canvas-selection";

const size = { width: 800, height: 600 };
const doc: CanvasDoc = {
  nodes: [{ id: "card", type: "text", text: "", x: 100, y: 100, width: 200, height: 100 }],
  edges: [],
};

const pressedBy = (pointer: PointerKind): PointerContext => ({
  doc,
  membership: canvasMembership(doc.nodes),
  scope: null,
  selection: selectNode("card"),
  byId: new Map(doc.nodes.map((node) => [node.id, node])),
  view: viewOfPan({ x: 0, y: 0 }, 1, size),
  size,
  pointer,
});

/** A press on the card by `pointer` that wanders (dx, 0) before it is let go: what it writes. */
function press(pointer: PointerKind, dx: number) {
  const ctx = pressedBy(pointer);
  const at = { x: 150 + dx, y: 150 };
  const started = pointerReduce(
    createPointerState(),
    { type: "move/start", id: "card", screen: { x: 150, y: 150 } },
    ctx,
  );
  const moved = pointerReduce(
    started.state,
    { type: "pointer/move", screen: at, shiftKey: false },
    ctx,
  );
  return pointerReduce(moved.state, { type: "pointer/end", screen: at }, ctx).doc;
}

test("the slop is the pressing pointer's: a finger's tap wanders further than a click", () => {
  const between = POINTER_SLOPS.mouse + 2;
  expect(between).toBeLessThanOrEqual(POINTER_SLOPS.touch);
  expect(press("mouse", between)).toBeDefined();
  expect(press("touch", between)).toBeUndefined();
  expect(press("touch", POINTER_SLOPS.touch + 2)).toBeDefined();
});
