/**
 * W4 query-node lib: definition extraction, result-id mapping, and the
 * collapse state a query node starts with.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { isQueryNode, present, queryDefOf } from "@kb/model";
import { fixtureGraph } from "@/api/fixture-graph";
import { resultNodeIds, SYSTEM_IDS, WORKSPACE_ROOT_ID } from "@kb/ui-sdk";
import { useGraphStore } from "@/stores/graph.store";
import { resetOutlineStore } from "@/test-support/outline-store";
import type { WireNode } from "@kb/contracts";
import { outlineNodes, useOutlineStore } from "@kb/outline-ui";

const EDN = "[:find ?id ?text :where [?n :node/id ?id] [?n :node/text ?text]]";

function queryWire(id = "n.q1", extraProps: WireNode["props"] = {}): WireNode {
  return {
    id,
    text: "Open todos",
    props: {
      [SYSTEM_IDS.queryField]: [{ t: "str", v: EDN }],
      ...extraProps,
    },
    children: [],
    createdAt: "2026-08-08T00:00:00.000Z",
    updatedAt: "2026-08-08T00:00:00.000Z",
  };
}

function hydrate(extra: WireNode[] = []): void {
  useGraphStore.getState().hydrateFromWire([...fixtureGraph.nodes, ...extra], 1, "fixtures");
}

beforeEach(() => {
  try {
    localStorage.clear();
  } catch {
    // node env without localStorage
  }
  resetOutlineStore();
  hydrate([queryWire()]);
});

describe("queryDefOf / isQueryNode", () => {
  it("extracts EDN and limit from a query node", () => {
    hydrate([
      queryWire("n.q1", {
        [SYSTEM_IDS.queryLimitField]: [{ t: "num", v: 3 }],
      }),
    ]);
    const node = outlineNodes().get("n.q1");
    expect(isQueryNode(node)).toBe(true);
    expect(queryDefOf(node)).toEqual({ edn: EDN, limit: 3 });
  });

  it("null for plain nodes, and for a query node whose EDN is blank", () => {
    const plain = outlineNodes().get("n.root-c");
    expect(isQueryNode(plain)).toBe(false);
    expect(queryDefOf(plain)).toBeNull();

    // The field is present but empty — still a query node (that is what the
    // row the user is editing looks like), with nothing yet to subscribe to.
    hydrate([
      {
        ...queryWire("n.q2"),
        props: { [SYSTEM_IDS.queryField]: [{ t: "str", v: "" }] },
      },
    ]);
    const noEdn = outlineNodes().get("n.q2");
    expect(isQueryNode(noEdn)).toBe(true);
    expect(queryDefOf(noEdn)).toBeNull();
  });

  it("a node merely TAGGED `query` is not a query node — the field is the kind", () => {
    // The old reader accepted any tag whose name was "query", so a user tag
    // called `query` silently turned its members into live subscriptions.
    hydrate([
      {
        id: "t.query",
        text: "query",
        props: { [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.tag }] },
        children: [],
        createdAt: "2026-08-08T00:00:00.000Z",
        updatedAt: "2026-08-08T00:00:00.000Z",
      },
      {
        id: "n.tagged",
        text: "tagged, not a query",
        props: { [SYSTEM_IDS.typeField]: [{ t: "ref", v: "t.query" }] },
        children: [],
        createdAt: "2026-08-08T00:00:00.000Z",
        updatedAt: "2026-08-08T00:00:00.000Z",
      },
    ]);
    const tagged = outlineNodes().get("n.tagged");
    expect(isQueryNode(tagged)).toBe(false);
    expect(queryDefOf(tagged)).toBeNull();
  });
});

describe("resultNodeIds", () => {
  it("picks known node ids, dedupes, excludes self, applies limit", () => {
    const nodes = outlineNodes();
    const rows: unknown[][] = [
      ["n.root-a", "Ship kb ui shell"],
      ["n.root-a", "duplicate"],
      ["n.q1", "the query node itself"],
      ["not-a-node", "unknown id → skipped"],
      ["n.root-b", "Search jumps to matching nodes"],
      ["n.root-c", "over limit"],
    ];
    expect(resultNodeIds(rows, nodes, { limit: 2, excludeId: "n.q1" })).toEqual([
      "n.root-a",
      "n.root-b",
    ]);
    expect(resultNodeIds(rows, nodes, { excludeId: "n.q1" })).toEqual([
      "n.root-a",
      "n.root-b",
      "n.root-c",
    ]);
  });
});

describe("query node collapse state (cheap-by-default)", () => {
  it("defaults collapsed, toggles without children, others still gated", () => {
    const store = useOutlineStore.getState();
    const q1 = present(outlineNodes().get("n.q1"), "n.q1");
    expect(q1.collapsed).toBe(true);
    expect(q1.children).toEqual([]);

    store.toggleCollapse("n.q1");
    expect(present(outlineNodes().get("n.q1"), "n.q1").collapsed).toBe(false);

    // Non-query leaf nodes still cannot toggle.
    useOutlineStore.getState().toggleCollapse("n.root-c");
    expect(present(outlineNodes().get("n.root-c"), "n.root-c").collapsed).toBe(false);

    useOutlineStore.getState().toggleCollapse("n.q1");
    expect(present(outlineNodes().get("n.q1"), "n.q1").collapsed).toBe(true);
  });

  it("expanded state survives a tx-driven map rebuild", () => {
    const store = useOutlineStore.getState();
    store.toggleCollapse("n.q1");
    expect(present(outlineNodes().get("n.q1"), "n.q1").collapsed).toBe(false);
    // Simulate an incoming WS tx touching an unrelated node.
    useGraphStore.getState().applyTx(
      [
        {
          id: "n.new",
          text: "from tx",
          props: {},
          children: [],
          createdAt: "2026-08-08T01:00:00.000Z",
          updatedAt: "2026-08-08T01:00:00.000Z",
        },
      ],
      [],
      { rev: 2 },
    );
    const graph = useGraphStore.getState();
    expect(outlineNodes().get("n.new")).toBeDefined();
    expect(present(outlineNodes().get("n.q1"), "n.q1").collapsed).toBe(false);
    expect(graph.rootNodeId).toBe(WORKSPACE_ROOT_ID);
  });
});
