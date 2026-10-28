import { expect, test } from "vitest";
import { canvasMembership, type CanvasDoc } from "@kb/canvas";
import { viewOfPan } from "./canvas-camera";
import { createPointerState, pointerReduce, type PointerContext } from "./canvas-pointer";
import { EMPTY_SELECTION, selectNode, type CanvasSelection } from "./canvas-selection";

const size = { width: 800, height: 600 };
const doc: CanvasDoc = {
  nodes: [
    { id: "note", type: "text", text: "words", x: 100, y: 100, width: 200, height: 100 },
    { id: "other", type: "text", text: "more", x: 400, y: 100, width: 200, height: 100 },
    { id: "picture", type: "file", file: "a.png", x: 100, y: 300, width: 200, height: 100 },
  ],
  edges: [],
};

const context = (selection: CanvasSelection): PointerContext => ({
  doc,
  membership: canvasMembership(doc.nodes),
  scope: null,
  selection,
  byId: new Map(doc.nodes.map((node) => [node.id, node])),
  view: viewOfPan({ x: 0, y: 0 }, 1, size),
  size,
  pointer: "touch",
});

/** A press on `id` with `selection` standing, wandering (dx, 0) before it lifts: the release. */
function press(id: string, selection: CanvasSelection, dx = 0) {
  const ctx = context(selection);
  const from = { x: 150, y: 150 };
  const at = { x: 150 + dx, y: 150 };
  const started = pointerReduce(
    createPointerState(),
    { type: "move/start", id, screen: from },
    ctx,
  );
  const moved = pointerReduce(
    started.state,
    { type: "pointer/move", screen: at, shiftKey: false },
    ctx,
  );
  return pointerReduce(moved.state, { type: "pointer/end", screen: at }, ctx);
}

test("a click on the one item selected opens its editor, as tldraw's second click does", () => {
  const released = press("note", selectNode("note"));
  expect(released.edit).toBe("note");
  expect(released.doc).toBeUndefined();
});

test("the first click only selects: what was selected before the press decides", () => {
  expect(press("note", EMPTY_SELECTION).edit).toBeUndefined();
  expect(press("note", selectNode("other")).edit).toBeUndefined();
  const both: CanvasSelection = { nodeIds: new Set(["note", "other"]), edgeIds: new Set() };
  expect(press("note", both).edit).toBeUndefined();
});

test("a press that goes past the slop carries the item and opens nothing", () => {
  const released = press("note", selectNode("note"), 40);
  expect(released.edit).toBeUndefined();
  expect(released.doc).toBeDefined();
});

test("an item with no editor is not opened", () => {
  expect(press("picture", selectNode("picture")).edit).toBeUndefined();
});
