import { describe, expect, it } from "vitest";
import type { WireNode } from "@kb/contracts";
import { SYSTEM_IDS, present, siblingSlots, viewOptionId, type PropValue } from "@kb/model";
import { fixtureGraph } from "@/api/fixture-graph";
import {
  frameViewIs,
  planDelete,
  planEditFrameView,
  planIndent,
  planInsertSibling,
  planMergeInto,
  planMove,
  planOutdent,
  planMoveToGroup,
  planReplaceField,
  planSetProp,
  planSplit,
} from "./plan.ts";

describe("outline action input builders", () => {
  it("split keeps the expanded-first-child decision in the UI", () => {
    expect(
      planSplit(fixtureGraph.nodes, "n.root-a", 4, "new", {
        expandedIds: new Set(["n.root-a"]),
      }).actions,
    ).toEqual([
      { id: "node.update", input: { id: "n.root-a", text: "Ship" } },
      {
        id: "node.add",
        input: { id: "new", text: " kb ui shell", parent: "n.root-a", position: 0 },
      },
    ]);
  });

  it("delete delegates cascade semantics to node.update", () => {
    expect(planDelete(fixtureGraph.nodes, "n.root-a").actions).toEqual([
      { id: "node.delete", input: { id: "n.root-a", descendants: "cascade" } },
    ]);
  });

  it("indent and parented move emit positions, not rewritten parents", () => {
    expect(present(planIndent(fixtureGraph.nodes, ["n.child-a2"]), "indent").actions).toEqual([
      { id: "node.update", input: { id: "n.child-a2", parent: "n.child-a1", position: 0 } },
    ]);
    expect(present(planMove(fixtureGraph.nodes, ["n.child-a2"], "up"), "move").actions).toEqual([
      { id: "node.update", input: { id: "n.child-a2", position: 0 } },
    ]);
  });

  it("a block of siblings is planned as one write, each row placed after the one before it", () => {
    const roots = siblingSlots(fixtureGraph.nodes, null).map((n) => n.id);
    const block = ["n.root-b", "n.root-c"];
    // Under the sibling before it, after that sibling's children, in order.
    expect(present(planIndent(fixtureGraph.nodes, block), "indent").actions).toEqual([
      { id: "node.update", input: { id: "n.root-b", parent: "n.root-a", position: 2 } },
      { id: "node.update", input: { id: "n.root-c", parent: "n.root-a", position: 3 } },
    ]);
    // Up: each row takes the place of the sibling above, in order.
    const at = roots.filter((id) => id !== "n.root-b").indexOf("n.root-a");
    expect(present(planMove(fixtureGraph.nodes, block, "up"), "up").actions).toEqual([
      { id: "node.update", input: { id: "n.root-b", position: at } },
      { id: "node.update", input: { id: "n.root-c", position: at + 1 } },
    ]);
    // Out: after the parent, in order.
    const children = ["n.child-a1", "n.child-a2"];
    const after = roots.indexOf("n.root-a") + 1;
    expect(present(planOutdent(fixtureGraph.nodes, children), "outdent").actions).toEqual([
      { id: "node.update", input: { id: "n.child-a1", parent: null, position: after } },
      { id: "node.update", input: { id: "n.child-a2", parent: null, position: after + 1 } },
    ]);
  });

  it("plans nothing for rows that are not one run of siblings", () => {
    expect(planIndent(fixtureGraph.nodes, ["n.child-a2", "n.root-b"])).toBeNull();
    expect(planMove(fixtureGraph.nodes, ["n.root-a", "n.root-c"], "down")).toBeNull();
    expect(planOutdent(fixtureGraph.nodes, ["n.root-b"])).toBeNull();
  });

  it("root inserts and moves send a position in the root group, never a rank", () => {
    const roots = siblingSlots(fixtureGraph.nodes, null).map((n) => n.id);
    const moved = present(planMove(fixtureGraph.nodes, ["n.root-b"], "up"), "root move").actions;
    // Before the visible root above it, counted over the whole root group.
    expect(moved).toEqual([
      {
        id: "node.update",
        input: {
          id: "n.root-b",
          position: roots.filter((id) => id !== "n.root-b").indexOf("n.root-a"),
        },
      },
    ]);
    const inserted = planInsertSibling(fixtureGraph.nodes, "n.root-a", "after", "new").actions;
    expect(inserted).toEqual([
      {
        id: "node.add",
        input: { id: "new", text: "", parent: null, position: roots.indexOf("n.root-a") + 1 },
      },
    ]);
  });

  it("merge is one action, so the commit takes or refuses it whole, and keeps UI focus metadata", () => {
    const merged = present(planMergeInto(fixtureGraph.nodes, "n.child-a2", "n.child-a1"), "merge");
    expect(merged.focusId).toBe("n.child-a1");
    expect(merged.actions).toEqual([
      { id: "node.merge", input: { id: "n.child-a2", into: "n.child-a1" } },
    ]);
  });

  it("replaces a property in one node.update: unset and set in the same transaction", () => {
    expect(
      planSetProp(
        fixtureGraph.nodes,
        "n.root-a",
        "field",
        { t: "str", v: "new" },
        { t: "str", v: "old" },
      ).actions,
    ).toEqual([
      {
        id: "node.update",
        input: {
          id: "n.root-a",
          unsetProps: [{ field: "field", value: { t: "str", v: "old" } }],
          setProps: [{ field: "field", value: { t: "str", v: "new" } }],
        },
      },
    ]);
  });
});

const ref = (v: string): PropValue => ({ t: "ref", v });
const wire = (id: string, props: WireNode["props"], children: string[] = []): WireNode => ({
  id,
  text: "",
  props,
  children,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

describe("editing a frame's view", () => {
  const snippet = wire("v.snippet", {
    [SYSTEM_IDS.viewField]: [ref(viewOptionId("outline.snippet"))],
  });
  const table = wire("v.table", { [SYSTEM_IDS.viewField]: [ref(viewOptionId("outline.table"))] });
  const graph = (frameViews: string[]) => [
    ...fixtureGraph.nodes.filter((n) => n.id !== SYSTEM_IDS.viewsList),
    wire(SYSTEM_IDS.viewsList, {}, ["v.snippet", "v.table"]),
    snippet,
    table,
    wire("f", { [SYSTEM_IDS.viewsField]: frameViews.map(ref) }),
  ];
  const toBoard = frameViewIs(viewOptionId("outline.board"));

  it("writes the first frame view the frame names, never a view of another kind before it", () => {
    const plan = present(
      planEditFrameView(graph(["v.snippet", "v.table"]), "f", toBoard, "v.new"),
      "edit",
    );
    expect(plan.actions.map((a) => [a.id, (a.input as { id: string }).id])).toEqual([
      ["node.update", "v.table"],
    ]);
  });

  it("makes a frame view first when the frame names only views of another kind", () => {
    const plan = present(planEditFrameView(graph(["v.snippet"]), "f", toBoard, "v.new"), "edit");
    expect(plan.actions).toEqual([
      {
        id: "node.add",
        input: {
          id: "v.new",
          text: "",
          parent: SYSTEM_IDS.viewsList,
          position: 2,
          props: [{ field: SYSTEM_IDS.viewField, value: ref(viewOptionId("outline.board")) }],
        },
      },
      {
        id: "node.update",
        input: {
          id: "f",
          unsetProps: [{ field: SYSTEM_IDS.viewsField }],
          setProps: [
            { field: SYSTEM_IDS.viewsField, value: ref("v.new") },
            { field: SYSTEM_IDS.viewsField, value: ref("v.snippet") },
          ],
        },
      },
    ]);
  });
});

describe("moving a row to a group", () => {
  const doing = ref("o.doing");
  const done = ref("o.done");
  const card = wire("c", { "f.status": [doing, ref("o.blocked")] });

  it("replaces every value of the field with the group's, or removes them for No <field>", () => {
    expect(planMoveToGroup([card], "c", "f.status", done)).toEqual(
      planReplaceField([card], "c", "f.status", [done]),
    );
    expect(planMoveToGroup([card], "c", "f.status", null)).toEqual(
      planReplaceField([card], "c", "f.status", []),
    );
  });

  it("writes nothing for the group the row is in, by its first value", () => {
    expect(planMoveToGroup([card], "c", "f.status", doing)).toBeNull();
    expect(planMoveToGroup([wire("c", {})], "c", "f.status", null)).toBeNull();
  });
});
