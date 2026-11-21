import { describe, expect, it } from "vitest";
import { present } from "@kb/model";
import type { LensNode } from "./graph-lens";
import type { LensEdge } from "@kb/graph";
import {
  computeLayoutPositions,
  depthLayers,
  gridLayout,
  hierarchicalLayout,
  radialLayout,
} from "./graph-layouts.ts";

function byKey(x: [string, unknown], y: [string, unknown]): number {
  return x[0].localeCompare(y[0]);
}

function nodes(ids: string[]): LensNode[] {
  return ids.map((id, i) => ({
    id,
    label: id,
    color: "#000",
    size: 5,
    clusterKey: "none",
    tags: [],
    degree: i,
  }));
}

function edge(source: string, target: string): LensEdge {
  return { source, target, kind: "child", weight: 1 };
}

describe("graph-layouts", () => {
  const size = { width: 800, height: 600 };

  it("force returns null (FA2 owns it)", () => {
    expect(computeLayoutPositions("force", nodes(["a"]), [], size)).toBeNull();
  });

  it("radial is deterministic for a fixture", () => {
    const a = radialLayout(nodes(["c", "a", "b"]), size);
    const b = radialLayout(nodes(["b", "c", "a"]), size);
    expect([...a.entries()].toSorted(byKey)).toEqual([...b.entries()].toSorted(byKey));
    expect(a.size).toBe(3);
  });

  it("grid assigns unique cells", () => {
    const pos = gridLayout(nodes(["n1", "n2", "n3", "n4"]), size);
    const pts = [...pos.values()];
    const keys = new Set(pts.map((p) => `${p.x},${p.y}`));
    expect(keys.size).toBe(4);
  });

  it("hierarchical layers by edge depth", () => {
    const ns = nodes(["root", "mid", "leaf"]);
    const edges: LensEdge[] = [
      { source: "root", target: "mid", kind: "child", weight: 1 },
      { source: "mid", target: "leaf", kind: "child", weight: 1 },
    ];
    const pos = hierarchicalLayout(ns, edges, size);
    const root = present(pos.get("root"), "root");
    const mid = present(pos.get("mid"), "mid");
    const leaf = present(pos.get("leaf"), "leaf");
    expect(root.x).toBeLessThan(mid.x);
    expect(mid.x).toBeLessThan(leaf.x);
  });

  it("layers a node at its shortest depth from the roots, not its first-visited one", () => {
    // a → b → c and the shortcut a → c: c stands one column from a, beside b.
    const layers = depthLayers(nodes(["a", "b", "c"]), [
      edge("a", "b"),
      edge("b", "c"),
      edge("a", "c"),
    ]);
    expect([...layers]).toEqual([
      [0, ["a"]],
      [1, ["b", "c"]],
    ]);
  });

  it("guards a cycle: with no root the first id is one, and the walk ends", () => {
    const layers = depthLayers(nodes(["c", "a", "b"]), [
      edge("a", "b"),
      edge("b", "c"),
      edge("c", "a"),
    ]);
    expect([...layers]).toEqual([
      [0, ["a"]],
      [1, ["b"]],
      [2, ["c"]],
    ]);
  });

  it("puts a cycle no root reaches in the first layer, and ignores edges off the node set", () => {
    const layers = depthLayers(nodes(["r", "x", "y"]), [
      edge("x", "y"),
      edge("y", "x"),
      edge("r", "gone"),
    ]);
    expect([...layers]).toEqual([[0, ["r", "x", "y"]]]);
  });

  it("snapshots hierarchical positions for regression", () => {
    const ns = nodes(["a", "b", "c", "d"]);
    const pos = hierarchicalLayout(ns, [edge("a", "b"), edge("a", "c"), edge("c", "d")], size);
    expect([...pos].toSorted(byKey)).toEqual([
      ["a", { x: 200, y: 300 }],
      ["b", { x: 400, y: 200 }],
      ["c", { x: 400, y: 400 }],
      ["d", { x: 600, y: 300 }],
    ]);
  });

  it("snapshots positions for regression", () => {
    const ns = nodes(["a", "b", "c", "d"]);
    const pos = radialLayout(ns, size);
    expect(pos.get("a")).toEqual({ x: 400, y: 72 });
    expect(pos.get("b")).toEqual({ x: 628, y: 300 });
    expect(pos.get("c")).toEqual({ x: 400, y: 528 });
    expect(pos.get("d")).toEqual({ x: 172, y: 300 });
  });
});
