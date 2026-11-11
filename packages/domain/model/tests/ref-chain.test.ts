/**
 * Where a ref field leads (`refChain`): breadth first in declared order,
 * each node once, ending where a cycle closes; and whether a new value would
 * close one (`closesCycle`), asked of the same walk.
 */
import { describe, expect, test } from "bun:test";
import type { NodeId, PropValue } from "../src/model.ts";
import { closesCycle, refChain } from "../src/ref-chain.ts";

const FIELD = "f.parent";
const OTHER = "f.other";

/** A graph where each node's `FIELD` values are the ids listed for it. */
function graph(edges: Readonly<Record<NodeId, readonly NodeId[]>>) {
  const nodes = new Map(
    Object.entries(edges).map(([id, to]) => [
      id,
      { props: { [FIELD]: to.map((v): PropValue => ({ t: "ref", v })) } },
    ]),
  );
  return (id: NodeId) => nodes.get(id);
}

describe("a ref field's chain", () => {
  test("is breadth first in declared order, each node once", () => {
    const nodeOf = graph({ a: ["b", "c"], b: ["d"], c: ["d"], d: [] });
    expect(refChain(nodeOf, FIELD, "a")).toEqual(["a", "b", "c", "d"]);
  });

  test("ends where a cycle closes, and reads only its own field", () => {
    const nodeOf = graph({ a: ["b"], b: ["a"] });
    expect(refChain(nodeOf, FIELD, "a")).toEqual(["a", "b"]);
    expect(refChain(nodeOf, OTHER, "a")).toEqual(["a"]);
  });

  test("names a node missing from the graph, and stops there", () => {
    expect(refChain(graph({ a: ["gone"] }), FIELD, "a")).toEqual(["a", "gone"]);
  });
});

describe("whether a value closes a cycle", () => {
  const nodeOf = graph({ a: ["b"], b: ["c"], c: [], d: [] });

  test("holds for the holder itself, and for a node whose chain reaches it", () => {
    expect(closesCycle(nodeOf, FIELD, "a", "a")).toBe(true);
    expect(closesCycle(nodeOf, FIELD, "c", "a")).toBe(true);
    expect(closesCycle(nodeOf, FIELD, "b", "a")).toBe(true);
  });

  test("does not for a node whose chain never reaches the holder", () => {
    expect(closesCycle(nodeOf, FIELD, "a", "c")).toBe(false);
    expect(closesCycle(nodeOf, FIELD, "a", "d")).toBe(false);
  });
});
