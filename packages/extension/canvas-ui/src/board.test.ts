/**
 * A board's pins go in rows below what is on it: each card under its
 * picture, and a node already on the board is not placed again.
 */
import { describe, expect, test, vi } from "vitest";
import { stringifyCanvasDoc, type CanvasDoc } from "@kb/canvas";
import type { OutlineNode } from "@kb/ui-sdk";
import { canvasBoard, placementsFor } from "./board";

const DOC: CanvasDoc = {
  nodes: [{ id: "a", type: "kb-node", nodeId: "pin-1", x: 0, y: 0, width: 280, height: 72 }],
  edges: [],
};

describe("the canvas board", () => {
  test("places cards in rows below the board's lowest item, each under its picture", () => {
    const placed = placementsFor(DOC, [
      { node: "pin-2", picture: "assets/p.webp" },
      { node: "pin-3" },
    ]);
    expect(placed).toEqual([
      {
        make: { preset: "image", file: "assets/p.webp", width: 280, height: 280 },
        at: { x: 0, y: 112 },
      },
      {
        make: { preset: "kb-node", nodeId: "pin-2", width: 280, height: 72 },
        at: { x: 0, y: 400 },
      },
      {
        make: { preset: "kb-node", nodeId: "pin-3", width: 280, height: 72 },
        at: { x: 300, y: 112 },
      },
    ]);
  });

  test("pins onto the owner's canvas child, skipping a node already shown", async () => {
    const canvas = {
      id: "board",
      text: "Board",
      children: [],
      props: {
        "sys.f.type": [{ t: "ref", v: "sys.tag.canvas" }],
        "sys.f.canvas": [{ t: "str", v: stringifyCanvasDoc(DOC) }],
      },
    } as unknown as OutlineNode;
    const owner = {
      id: "look",
      text: "Look",
      children: ["board"],
      props: {},
    } as unknown as OutlineNode;
    const nodes = new Map([
      ["look", owner],
      ["board", canvas],
    ]);
    const invoke = vi.fn(async () => ({ status: "succeeded" as const, id: "x", output: {} }));
    const board = canvasBoard({ node: (id) => nodes.get(id), invoke });
    const reply = await board.pin("look", "Look", [{ node: "pin-1" }, { node: "pin-2" }]);
    expect(reply).toEqual({ ok: true, board: "board", path: "/canvas/board", placed: 1 });
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  test("makes the board under its owner when it has none, through the host it was given", async () => {
    const owner = { id: "look", text: "Look", children: [], props: {} } as unknown as OutlineNode;
    const calls: Array<{ id: string; input: Record<string, unknown> }> = [];
    const invoke = vi.fn(async (id: string, input: unknown) => {
      calls.push({ id, input: input as Record<string, unknown> });
      return { status: "succeeded" as const, id, output: {} };
    });
    const board = canvasBoard({ node: (id) => (id === "look" ? owner : undefined), invoke });
    const reply = await board.pin("look", "Look — moodboard", [{ node: "pin-1" }]);
    const made = calls[0];
    expect(made?.id).toBe("node.add");
    expect(made?.input).toMatchObject({ text: "Look — moodboard", parent: "look" });
    expect(calls[1]).toMatchObject({
      id: "ext.canvas.place",
      input: { canvasId: made?.input["id"] },
    });
    expect(reply).toMatchObject({ ok: true, board: made?.input["id"], placed: 1 });
  });
});
