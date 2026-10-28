/**
 * Items changed in place by id (`edit.ts`): words, colour, looks, link,
 * lock, node and size; a move by a delta that carries members and settles
 * membership as a nudge does; a delete of items and edges; and items taken
 * to another page with their members and the edges among them. A locked
 * item keeps its place and size.
 */
import { describe, expect, test } from "bun:test";
import {
  CanvasRelationError,
  editCanvas,
  landItems,
  patchItem,
  takeItems,
  type CanvasDoc,
  type CanvasGroupNode,
  type CanvasNode,
  type CanvasTextNode,
} from "../src/index.ts";

const text = (
  id: string,
  x: number,
  y: number,
  more: Partial<CanvasTextNode> = {},
): CanvasTextNode => ({
  id,
  type: "text",
  text: id,
  x,
  y,
  width: 100,
  height: 60,
  ...more,
});
const frame = (id: string, x: number, y: number): CanvasGroupNode => ({
  id,
  type: "group",
  label: id,
  x,
  y,
  width: 400,
  height: 300,
});
const edge = (id: string, fromNode: string, toNode: string) => ({ id, fromNode, toNode });

/** A frame `f` holding `a` and `b`, a loose `c`, and edges a→b and b→c. */
const doc: CanvasDoc = {
  nodes: [
    frame("f", 0, 0),
    text("a", 20, 20, { parent: "f" }),
    text("b", 200, 20, { parent: "f" }),
    text("c", 600, 20),
  ],
  edges: [edge("ab", "a", "b"), edge("bc", "b", "c")],
};
const item = (d: CanvasDoc, id: string) => d.nodes.find((node) => node.id === id);

describe("patchItem", () => {
  test("sets words where an item has its own, and refuses a card's, which are its node's", () => {
    expect(patchItem(text("t", 0, 0), { text: "new" })).toMatchObject({ text: "new" });
    expect(patchItem(frame("f", 0, 0), { text: "Decide (16)" })).toMatchObject({
      label: "Decide (16)",
    });
    const card: CanvasNode = {
      id: "k",
      type: "kb-node",
      nodeId: "n1",
      x: 0,
      y: 0,
      width: 100,
      height: 60,
    };
    expect(() => patchItem(card, { text: "x" })).toThrow(CanvasRelationError);
  });
  test("sets and takes away colour, link and node; null is none", () => {
    const set = patchItem(text("t", 0, 0), {
      color: "blue",
      link: { node: "p", item: "i" },
      nodeId: "n1",
      style: { dash: "dashed" },
    });
    expect(set).toMatchObject({ link: { node: "p", item: "i" }, nodeId: "n1" });
    expect(set.color).toBeDefined();
    expect(set.style).toEqual({ dash: "dashed" });
    const cleared = patchItem(set, {
      color: null,
      link: null,
      nodeId: null,
      style: { dash: undefined },
    });
    expect(cleared).toEqual(text("t", 0, 0));
  });
  test("a lock holds an item's size, and its words, looks and link stay editable", () => {
    const locked = patchItem(text("t", 0, 0), { locked: true });
    expect(locked.locked).toBe(true);
    expect(patchItem(locked, { text: "still" })).toMatchObject({ text: "still", locked: true });
    expect(() => patchItem(locked, { width: 300 })).toThrow(/locked/);
    expect(patchItem(text("t", 10, 10), { width: 300 })).toMatchObject({
      x: 10,
      y: 10,
      width: 300,
    });
  });
});

describe("editCanvas", () => {
  test("a move by a delta carries a frame's members, and lands where the drop rule says", () => {
    const moved = editCanvas(doc, { move: ["f"], by: { x: 50, y: 10, z: 0 } });
    expect([item(moved, "f")?.x, item(moved, "a")?.x, item(moved, "b")?.y]).toEqual([50, 70, 30]);
    // Carried out of its frame, an item belongs to the canvas.
    const out = editCanvas(doc, { move: ["a"], by: { x: 1000, y: 0, z: 0 } });
    expect(item(out, "a")?.parent).toBeUndefined();
  });
  test("a delete takes items with their members and the edges that meet them, and edges by id", () => {
    const gone = editCanvas(doc, { delete: ["f"] });
    expect(gone.nodes.map((n) => n.id)).toEqual(["c"]);
    expect(gone.edges).toEqual([]);
    const cut = editCanvas(doc, { delete: ["bc"] });
    expect(cut.nodes).toHaveLength(4);
    expect(cut.edges.map((e) => e.id)).toEqual(["ab"]);
  });
  test("refuses an item it does not hold, and moving or deleting a locked one", () => {
    expect(() => editCanvas(doc, { update: "zz", set: { text: "x" } })).toThrow(/no item zz/);
    const locked = editCanvas(doc, { update: "c", set: { locked: true } });
    expect(() => editCanvas(locked, { move: ["c"], by: { x: 1, y: 0, z: 0 } })).toThrow(/locked/);
    expect(() => editCanvas(locked, { delete: ["c"] })).toThrow(/locked/);
    // Unlocked again, it goes.
    const free = editCanvas(locked, { update: "c", set: { locked: false } });
    expect(item(editCanvas(free, { delete: ["c"] }), "c")).toBeUndefined();
  });
});

describe("takeItems and landItems", () => {
  test("take items with their members and the edges among them; an edge to one left behind goes", () => {
    const taken = takeItems(doc, ["f"]);
    expect(taken.nodes.map((n) => n.id)).toEqual(["f", "a", "b"]);
    expect(taken.edges.map((e) => e.id)).toEqual(["ab"]);
    expect(taken.left).toEqual({ nodes: [text("c", 600, 20)], edges: [] });
    // A member taken without its frame belongs to the page it lands on.
    expect(takeItems(doc, ["a"]).nodes).toEqual([text("a", 20, 20)]);
  });
  test("land them where they stood, refusing an id the page already holds", () => {
    const taken = takeItems(doc, ["f"]);
    const page = landItems({ nodes: [text("z", 0, 500)], edges: [] }, taken);
    expect(page.nodes.map((n) => n.id)).toEqual(["z", "f", "a", "b"]);
    expect(item(page, "a")).toEqual(item(doc, "a"));
    expect(() => landItems(doc, taken)).toThrow(/already holds f, a, b, ab/);
  });
});
