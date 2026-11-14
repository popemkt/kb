/**
 * Where a row's drag drops (DESIGN-UI.md → Outline editor, "A row moves
 * anywhere"): the line drawn and the place moved to are one answer, a
 * function of the row under the pointer; nothing moves under a row moved;
 * the scroller scrolls only near its edges, faster nearer them.
 */
import { describe, expect, it } from "vitest";
import type { NodeMap, OutlineNode } from "@kb/ui-sdk";
import { dropOver, type DropRow, edgeStep, ghostAt, underMoved } from "./row-drag";

const row = (over: Partial<DropRow> = {}): DropRow => ({
  id: "n.row",
  shownId: "n.row",
  parent: "n.parent",
  before: "n.before",
  childrenShown: false,
  box: { top: 100, bottom: 124, left: 40, right: 400, textLeft: 64 },
  ...over,
});

describe("a drop over a row", () => {
  it("above its middle, lands before it, the line on its top edge", () => {
    expect(dropOver(row(), 50, 105)).toEqual({
      place: { parent: "n.parent", after: "n.before" },
      line: { top: 100, left: 40, right: 400 },
      into: null,
    });
    // The first of its siblings: first in its parent.
    expect(dropOver(row({ before: null }), 50, 105).place).toEqual({
      parent: "n.parent",
      after: null,
    });
  });

  it("below its middle, lands after it, the line on its bottom edge", () => {
    expect(dropOver(row(), 50, 120)).toEqual({
      place: { parent: "n.parent", after: "n.row" },
      line: { top: 124, left: 40, right: 400 },
      into: null,
    });
  });

  it("below it past its text start, or over its children, lands as its first child", () => {
    const child = {
      place: { parent: "n.row", after: null },
      line: { top: 124, left: 64, right: 400 },
      into: "n.row",
    };
    expect(dropOver(row(), 80, 120)).toEqual(child);
    expect(dropOver(row({ childrenShown: true }), 50, 120)).toEqual(child);
  });

  it("as a reference row's child, lands under the node it shows", () => {
    expect(dropOver(row({ shownId: "n.target" }), 80, 120).place).toEqual({
      parent: "n.target",
      after: null,
    });
  });

  it("at the top level, lands with no parent", () => {
    expect(dropOver(row({ parent: null }), 50, 120).place).toEqual({
      parent: null,
      after: "n.row",
    });
  });
});

const node = (id: string, parentId: string | null): OutlineNode =>
  ({ id, parentId, children: [] }) as unknown as OutlineNode;

describe("where the rows moved cannot go", () => {
  const nodes: NodeMap = new Map([
    ["a", node("a", null)],
    ["b", node("b", "a")],
    ["c", node("c", "b")],
    ["d", node("d", null)],
  ]);

  it("is a row moved or anywhere under one", () => {
    const moved = new Set(["b"]);
    expect(underMoved(nodes, moved, "b")).toBe(true);
    expect(underMoved(nodes, moved, "c")).toBe(true);
    expect(underMoved(nodes, moved, "a")).toBe(false);
    expect(underMoved(nodes, moved, "d")).toBe(false);
  });
});

describe("scrolling while a row is dragged", () => {
  it("scrolls near the edges only, faster nearer them", () => {
    expect(edgeStep(300, 0, 600)).toBe(0);
    expect(edgeStep(40, 0, 600)).toBeLessThan(0);
    expect(edgeStep(560, 0, 600)).toBeGreaterThan(0);
    expect(edgeStep(2, 0, 600)).toBeLessThan(edgeStep(40, 0, 600));
    expect(edgeStep(598, 0, 600)).toBeGreaterThan(edgeStep(560, 0, 600));
  });
});

describe("the ghost of the rows dragged", () => {
  const aimed = { box: { top: 100, bottom: 124, left: 0, right: 600, textLeft: 28 } };

  it("sits right of the pointer and below the row aimed at, so that row stays readable", () => {
    const at = ghostAt({ x: 40, y: 104 }, aimed);
    expect(at.x).toBeGreaterThan(40);
    expect(at.y).toBeGreaterThan(aimed.box.bottom);
  });

  it("over no row, sits just below the pointer", () => {
    const at = ghostAt({ x: 40, y: 300 }, null);
    expect(at.y).toBeGreaterThan(300);
    expect(at.y).toBeLessThan(324);
  });
});
