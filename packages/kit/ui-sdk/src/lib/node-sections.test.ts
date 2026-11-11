/**
 * Which sections a node's page shows (`nodeSectionsOf`): those contributed
 * for a tag it is, directly or through what its tags extend, that say they
 * show now, in ascending order.
 */
import { describe, expect, it } from "vitest";
import { SYSTEM_IDS } from "@kb/model";
import type { Contribution } from "@kb/plugin";
import { nodeSectionsOf, type NodeSection } from "./node-sections";
import type { NodeMap, OutlineNode } from "./types";

const ref = (v: string) => [{ t: "ref" as const, v }];

function node(id: string, props: OutlineNode["props"] = {}): OutlineNode {
  const at = "2026-11-11T00:00:00.000Z";
  return {
    id,
    text: id,
    parentId: null,
    children: [],
    collapsed: false,
    props,
    createdAt: at,
    updatedAt: at,
    tags: [],
  };
}

const NODES: NodeMap = new Map(
  [
    node("t.day"),
    node("t.my-day", { [SYSTEM_IDS.extendsField]: ref("t.day") }),
    node("t.task"),
    node("a.day", { [SYSTEM_IDS.typeField]: ref("t.day") }),
    node("a.my-day", { [SYSTEM_IDS.typeField]: ref("t.my-day") }),
    node("a.task", { [SYSTEM_IDS.typeField]: ref("t.task") }),
    node("a.plain"),
  ].map((n) => [n.id, n]),
);

const Body = () => null;
function section(id: string, value: Partial<NodeSection>): Contribution<NodeSection> {
  return {
    id,
    value: { tags: ["t.day"], order: 0, title: id, Component: Body, ...value },
  } as Contribution<NodeSection>;
}

const ids = (id: string, contributed: readonly Contribution<NodeSection>[]) =>
  nodeSectionsOf(id, NODES, contributed).map((shown) => shown.id);

describe("a node page's sections", () => {
  const contributed = [
    section("late", { order: 30 }),
    section("early", { order: 10 }),
    section("task", { tags: ["t.task"] }),
  ];

  it("shows those for a tag the node carries, in ascending order", () => {
    expect(ids("a.day", contributed)).toEqual(["early", "late"]);
    expect(ids("a.task", contributed)).toEqual(["task"]);
  });

  it("shows a tag's sections on a node whose tag extends it", () => {
    expect(ids("a.my-day", contributed)).toEqual(["early", "late"]);
  });

  it("shows none on a node with no such tag, or no node", () => {
    expect(ids("a.plain", contributed)).toEqual([]);
    expect(ids("missing", contributed)).toEqual([]);
  });

  it("leaves out a section that says it does not show now, reading the graph", () => {
    const off = section("off", { shown: (nodes) => nodes.has("a.setting") });
    expect(ids("a.day", [off])).toEqual([]);
    const on = new Map(NODES).set("a.setting", node("a.setting"));
    expect(nodeSectionsOf("a.day", on, [off]).map((shown) => shown.id)).toEqual(["off"]);
  });
});
