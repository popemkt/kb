import { describe, expect, it } from "vitest";
import type { WireNode } from "@kb/contracts";
import { isRowOpen, wireToOutlineMap } from "./graph-view";
import { placeOfInstance } from "./instance-key";
import { schemaOf, schemaOfGraph } from "./schema";
import { SYSTEM_IDS } from "@kb/model";

const ISO = "2026-10-16T00:00:00.000Z";

function wire(id: string, children: string[] = [], props: WireNode["props"] = {}): WireNode {
  return { id, text: id, props, children, createdAt: ISO, updatedAt: ISO };
}

/**
 * Every reason a row defaults to collapsed, and a row of each kind that does
 * not: children, a visible field value, a query definition; a leaf, a row
 * whose only value is in a hidden field, and the field nodes themselves.
 */
const snapshot = (): WireNode[] => [
  wire("f.status", [], { [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.field }] }),
  wire("f.secret", [], {
    [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.field }],
    [SYSTEM_IDS.showField]: [{ t: "ref", v: SYSTEM_IDS.showNever }],
  }),
  wire("n.a", ["n.a1", "n.a2"]),
  wire("n.a1"),
  wire("n.a2", ["n.a21"]),
  wire("n.a21"),
  wire("n.fields", [], { "f.status": [{ t: "str", v: "doing" }] }),
  wire("n.hidden", [], { "f.secret": [{ t: "str", v: "shh" }] }),
  wire("n.query", [], { [SYSTEM_IDS.queryField]: [{ t: "str", v: "[:find ?id]" }] }),
  wire("n.b"),
];

describe("isRowOpen", () => {
  const schema = schemaOf({ wireNodes: snapshot() });
  const node = (id: string) => {
    const found = schema.get(id);
    if (found === undefined) throw new Error(id);
    return found;
  };
  const open = (id: string, expansion: ReadonlyMap<string, boolean> = new Map()) =>
    isRowOpen(node(id), `tree/${id}`, expansion);

  it("defaults: children, visible fields and a query collapse; a hidden value does not", () => {
    expect(["n.a", "n.fields", "n.query", "n.hidden", "n.b"].map((id) => open(id))).toEqual([
      false,
      false,
      false,
      true,
      true,
    ]);
  });

  it("reads the reader's choice for the row's place over its default, either way", () => {
    expect(open("n.a", new Map([[placeOfInstance("tree/n.a"), true]]))).toBe(true);
    expect(open("n.hidden", new Map([[placeOfInstance("tree/n.hidden"), false]]))).toBe(false);
  });

  it("builds nothing: the schema's rows are the projection at default collapse", () => {
    expect([...schema.entries()]).toEqual([...wireToOutlineMap(snapshot(), snapshot()).entries()]);
  });
});

describe("schemaOf", () => {
  it("a lookup changes nothing: a node's object does not depend on which snapshot was asked last", () => {
    const a = snapshot();
    const b = a.map((n) => (n.id === "n.b" ? { ...n, text: "b2" } : n));
    const c = b.map((n) => (n.id === "n.a1" ? { ...n, text: "a1-2" } : n));
    const sa = schemaOf({ wireNodes: a });
    const sb = schemaOf({ wireNodes: b });
    // Ask for the older snapshot again: a lookup, not a build.
    expect(schemaOf({ wireNodes: a })).toBe(sa);
    const sc = schemaOf({ wireNodes: c });
    expect(sc.get("n.a21")).toBe(sa.get("n.a21"));
    expect(sc.get("n.a21")).toBe(sb.get("n.a21"));
    expect(sc.get("n.b")).toBe(sb.get("n.b"));
    expect(sc.get("n.a1")).not.toBe(sb.get("n.a1"));
  });
});

describe("schemaOf identity follows content", () => {
  it("a, then b, then a again: back at a's content, every node is a's object again", () => {
    const a = snapshot();
    const sa = schemaOf({ wireNodes: a });
    const b = a.map((n) => (n.id === "n.b" ? { ...n, text: "b2" } : n));
    const sb = schemaOf({ wireNodes: b });
    expect(sb.get("n.b")).not.toBe(sa.get("n.b"));
    // A new snapshot with a's content: built, not looked up.
    const again = schemaOf({ wireNodes: a.map((n) => ({ ...n })) });
    expect(again).not.toBe(sa);
    for (const [id, node] of sa) expect(again.get(id)).toBe(node);
  });
});

describe("schemaOfGraph", () => {
  it("takes a projection of the whole graph, however its wire array was handed over", () => {
    const wireNodes = snapshot();
    expect(schemaOfGraph(wireToOutlineMap(wireNodes)).get("n.a21")).toBeDefined();
    const copy = wireToOutlineMap([...wireNodes], wireNodes);
    expect(schemaOfGraph(copy).get("n.a21")).toBeDefined();
  });

  it("refuses a projection of part of the graph", () => {
    const wireNodes = snapshot();
    const scoped = wireToOutlineMap(
      wireNodes.filter((n) => n.id !== "n.b"),
      wireNodes,
    );
    expect(() => schemaOfGraph(scoped)).toThrow(/scoped projection/);
  });
});
