/**
 * The read view's rows: a node's descendants in reading order, to a depth
 * and a cap, what is left out counted on the row that hides it.
 */
import { describe, expect, it } from "vitest";
import type { WireNode } from "@kb/contracts";
import { schemaOfGraph, SYSTEM_IDS, WORKSPACE_ROOT_ID, wireToOutlineMap } from "@kb/ui-sdk";
import { READ_DEPTH, readRows } from "@/lib/read-rows";

const ISO = "2026-10-24T00:00:00.000Z";

function wire(id: string, children: string[] = []): WireNode {
  return { id, text: id.toUpperCase(), props: {}, children, createdAt: ISO, updatedAt: ISO };
}

/**
 * a → b → c → d → e, and a → f: a chain deeper than the view lays out, beside
 * a leaf; and a → r, a reference to g, which reads as g and opens it.
 */
const graph: WireNode[] = [
  wire("a", ["b", "f", "r"]),
  wire("b", ["c"]),
  wire("c", ["d"]),
  wire("d", ["e"]),
  wire("e"),
  wire("f"),
  wire("g"),
  { ...wire("r"), text: "", props: { [SYSTEM_IDS.refTargetField]: [{ t: "ref", v: "g" }] } },
];
const nodes = schemaOfGraph(wireToOutlineMap(graph, new Set()));
const rows = (root: string, depth?: number, max?: number) =>
  readRows(nodes, nodes, root, depth, max).rows;

describe("the read view's rows", () => {
  it("lays descendants out in reading order, to its depth, counting what it leaves out", () => {
    expect(READ_DEPTH).toBe(3);
    expect(rows("a")).toEqual([
      { id: "b", text: "B", opens: "b", depth: 1, hidden: 0 },
      { id: "c", text: "C", opens: "c", depth: 2, hidden: 0 },
      { id: "d", text: "D", opens: "d", depth: 3, hidden: 1 },
      { id: "f", text: "F", opens: "f", depth: 1, hidden: 0 },
      { id: "r", text: "G", opens: "g", depth: 1, hidden: 0 },
    ]);
  });

  it("reads the workspace as its top-level nodes, and stops at its cap", () => {
    expect(rows(WORKSPACE_ROOT_ID, 1).map((row) => row.id)).toEqual(["a", "g"]);
  });

  it("spends its cap shallowest level first, so the top level always appears, and counts what it drops", () => {
    // Cap 2 would keep b, c in a depth-first walk and drop f and r; the top level wins instead.
    const capped = readRows(nodes, nodes, "a", READ_DEPTH, 2);
    expect(capped.rows.map((row) => row.id)).toEqual(["b", "f", "r"]);
    expect(capped.more).toBe(2);
    expect(readRows(nodes, nodes, "a").more).toBe(0);
    // The top level is never capped, even by a cap of none.
    expect(readRows(nodes, nodes, "a", READ_DEPTH, 0).rows.map((row) => row.id)).toEqual([
      "b",
      "f",
      "r",
    ]);
    // A level keeps what is left of the cap, in reading order, still under kept parents.
    expect(rows("a", READ_DEPTH, 4).map((row) => row.id)).toEqual(["b", "c", "f", "r"]);
  });

  it("reads a leaf, or a node the map does not hold, as no rows", () => {
    expect(rows("e")).toEqual([]);
    expect(rows("missing")).toEqual([]);
  });
});
