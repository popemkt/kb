/**
 * frame-rows is the single owner of frame row order and pagination. These
 * tests pin the contract every renderer and the nav walk share.
 */
import {
  paletteStepsPlugin,
  familyViews,
  frameRows,
  type FrameRowsInput,
  frameViewOf,
  type NodeMap,
  type OutlineNode,
  resolveTableColumns,
  type SchemaIndex,
  schemaOfGraph,
  ViewPoint,
} from "@kb/ui-sdk";
import { SYSTEM_IDS } from "@kb/model";
import { Effect, Schema } from "effect";
import { makeKernel } from "@kb/plugin";
import { browserHostUiPlugin } from "@/browser-host";
import { describe, expect, it } from "vitest";
import { isFrameViewKey } from "@kb/views";
import { framedAs, viewOptionNodes, type FrameViewName } from "@/fixtures/view-fields";
import { outlineUiPlugin } from "@/test-support/outline-plugin";
import { CollectionTableView } from "@kb/collections";
import { collectionsUiPlugin } from "@kb/collections-ui";

/** Frame row fixtures carry the schema of a seeded store, even for a missing frame. */
function schemaFor(nodes: NodeMap): SchemaIndex {
  const withOptions = new Map<string, OutlineNode>();
  for (const option of viewOptionNodes)
    withOptions.set(option.id, node(option.id, option.text, option.props, option.children));
  for (const [id, value] of nodes) withOptions.set(id, value);
  return schemaOfGraph(withOptions);
}

/** The frame views the outline plugin provides, as its hosts see them. */
const VIEWS = (() => {
  const kernel = makeKernel({ host: "page" });
  Effect.runSync(kernel.load(browserHostUiPlugin));
  Effect.runSync(kernel.load(paletteStepsPlugin));
  Effect.runSync(kernel.load(outlineUiPlugin));
  Effect.runSync(kernel.load(collectionsUiPlugin));
  return familyViews(kernel.contributions(ViewPoint), isFrameViewKey).map(({ key }) => key);
})();

/** A frame's rows input, in the view its props name, as every host resolves it. */
function input(nodes: NodeMap, frameId = "frame"): FrameRowsInput {
  const schema = schemaFor(nodes);
  const view = frameViewOf(nodes.get(frameId), schema, VIEWS);
  if (view === null) throw new Error("the outline plugin provides no list view");
  return { frameId, nodes, schema, view };
}

function rowsOf(nodes: NodeMap, frameId = "frame") {
  return frameRows(input(nodes, frameId));
}

/** Every setting a frame view reads, at its default: what each view's params keep a part of. */
const SETTINGS = {
  filters: [],
  sort: [],
  display: [],
  colwidth: {},
  pagesize: 100,
  groupFieldId: null,
  collapsed: [],
  hideEmpty: false,
  calc: {},
  dateFieldId: null,
  span: "month",
};

function node(
  id: string,
  text: string,
  props: OutlineNode["props"] = {},
  children: string[] = [],
): OutlineNode {
  return {
    id,
    text,
    parentId: null,
    children,
    collapsed: false,
    props,
    createdAt: "",
    updatedAt: "",
    tags: [],
  };
}

/** A frame of `rowCount` rows shown as `view`, whose view node carries `settings`. */
function graph(view: FrameViewName, settings: OutlineNode["props"], rowCount = 5): NodeMap {
  const map = new Map<string, OutlineNode>();
  const ids: string[] = [];
  for (let i = 0; i < rowCount; i++) {
    const id = `r${i}`;
    ids.push(id);
    map.set(id, node(id, `row ${i}`, { f_status: [{ t: "str", v: `s${i % 2}` }] }));
  }
  const [frame, viewNode] = framedAs(node("frame", "Frame", {}, ids), view, settings);
  map.set(frame.id, frame);
  map.set(viewNode.id, node(viewNode.id, "", viewNode.props));
  return map;
}

const pagesize = (size: number): OutlineNode["props"] => ({
  [SYSTEM_IDS.viewPagesizeField]: [{ t: "num", v: size }],
});

describe("which views paginate", () => {
  it("is the views whose params declare a page size: the table, today", () => {
    const paginating = VIEWS.filter((view) =>
      Object.hasOwn(Schema.decodeUnknownSync(view.params)(SETTINGS), "pagesize"),
    );
    expect(paginating).toEqual([CollectionTableView]);
  });
});

describe("frameRows pagination", () => {
  it("renders the first page and reports the rest as more", () => {
    const nodes = graph("table", pagesize(2));
    const rows = frameRows(input(nodes));
    expect(rows.ordered).toHaveLength(5);
    expect(rows.rendered.map((n) => n.id)).toEqual(["r0", "r1"]);
    expect(rows.hasMore).toBe(true);
  });

  it("reveals one further page per revealed page", () => {
    const nodes = graph("table", pagesize(2));
    expect(frameRows({ ...input(nodes), pages: 2 }).rendered.map((n) => n.id)).toEqual([
      "r0",
      "r1",
      "r2",
      "r3",
    ]);
    const all = frameRows({ ...input(nodes), pages: 3 });
    expect(all.rendered).toHaveLength(5);
    expect(all.hasMore).toBe(false);
  });

  it("tracks pages, not an absolute count, so pagesize changes re-derive", () => {
    // Same revealed page count against a larger pagesize shows more rows —
    // an absolute reveal count would have stayed stale at the old limit.
    const small = rowsOf(graph("table", pagesize(2)));
    const large = rowsOf(graph("table", pagesize(4)));
    expect(small.rendered).toHaveLength(2);
    expect(large.rendered).toHaveLength(4);
  });

  it("does not paginate non-paginating modes", () => {
    const nodes = graph("cards", {
      [SYSTEM_IDS.viewPagesizeField]: [{ t: "num", v: 2 }],
    });
    const rows = frameRows(input(nodes));
    expect(rows.rendered).toHaveLength(5);
    expect(rows.hasMore).toBe(false);
  });
});

describe("frameRows grouping", () => {
  it("board order is its columns flattened, and names the group field", () => {
    const nodes = graph("board", {
      [SYSTEM_IDS.viewGroupField]: [{ t: "ref", v: "f_status" }],
    });
    const rows = frameRows(input(nodes));
    expect(rows.groupFieldId).toBe("f_status");
    expect(rows.columns.length).toBeGreaterThan(1);
    expect(rows.ordered.map((n) => n.id)).toEqual(
      rows.columns.flatMap((c) => c.nodes.map((n) => n.id)),
    );
  });

  it("cards is a single ungrouped column", () => {
    const nodes = graph("cards", {
      [SYSTEM_IDS.viewGroupField]: [{ t: "ref", v: "f_status" }],
    });
    const rows = frameRows(input(nodes));
    expect(rows.groupFieldId).toBeNull();
    expect(rows.columns).toHaveLength(1);
    expect(rows.ordered).toHaveLength(5);
  });
});

const stage = (id: string | null): OutlineNode["props"] =>
  id === null ? {} : { f_stage: [{ t: "ref", v: id }] };

/**
 * A board grouped by an option field (todo, doing, done): row r0 is done,
 * r1 todo, r2 holds none; nothing is doing. Its view node adds `settings`.
 */
function optionBoard(settings: OutlineNode["props"] = {}): Map<string, OutlineNode> {
  const nodes = new Map(
    graph("board", { [SYSTEM_IDS.viewGroupField]: [{ t: "ref", v: "f_stage" }], ...settings }, 3),
  );
  nodes.set("f_stage", node("f_stage", "stage", {}, ["o_todo", "o_doing", "o_done"]));
  for (const id of ["o_todo", "o_doing", "o_done"]) nodes.set(id, node(id, id.slice(2)));
  nodes.set("r0", node("r0", "row 0", stage("o_done")));
  nodes.set("r1", node("r1", "row 1", stage("o_todo")));
  nodes.set("r2", node("r2", "row 2", stage(null)));
  return nodes;
}

/** Each group as `key:count`, `+` when folded. */
const groupsOf = (nodes: NodeMap) =>
  frameRows(input(nodes)).columns.map((c) => `${c.key}:${c.nodes.length}${c.collapsed ? "+" : ""}`);

describe("a grouped view's groups (DESIGN-UI.md → Groups)", () => {
  it("has a group per option, in the field's order, held or not, then No <field>", () => {
    expect(groupsOf(optionBoard())).toEqual([
      "ref:o_todo:1",
      "ref:o_doing:0",
      "ref:o_done:1",
      "__empty__:1",
    ]);
  });

  it("leaves out the groups no row falls in when it hides empty groups", () => {
    const nodes = optionBoard({ [SYSTEM_IDS.viewHideEmptyField]: [{ t: "bool", v: true }] });
    expect(groupsOf(nodes)).toEqual(["ref:o_todo:1", "ref:o_done:1", "__empty__:1"]);
  });

  it("keeps a folded group's count and leaves its rows out of the walk", () => {
    const nodes = optionBoard({
      [SYSTEM_IDS.viewCollapsedField]: [
        { t: "str", v: "ref:o_todo" },
        { t: "str", v: "ref:o_gone" },
      ],
    });
    expect(groupsOf(nodes)).toEqual([
      "ref:o_todo:1+",
      "ref:o_doing:0",
      "ref:o_done:1",
      "__empty__:1",
    ]);
    const rows = frameRows(input(nodes));
    expect(rows.ordered.map((n) => n.id)).toEqual(["r0", "r2"]);
    expect(rows.rendered.map((n) => n.id)).toEqual(["r0", "r2"]);
  });

  it("keeps a renamed option folded: the group is named by the option's id", () => {
    const nodes = optionBoard({
      [SYSTEM_IDS.viewCollapsedField]: [{ t: "str", v: "ref:o_todo" }],
    });
    nodes.set("o_todo", node("o_todo", "to do"));
    const todo = frameRows(input(nodes)).columns[0];
    expect(todo?.label).toBe("to do");
    expect(todo?.collapsed).toBe(true);
  });
});

describe("frameRows sources", () => {
  it("explicit rowIds override the frame's own children", () => {
    const nodes = graph("table", pagesize(10));
    const rows = frameRows({
      ...input(nodes),
      rowIds: ["r3", "r1"],
    });
    expect(rows.rendered.map((n) => n.id)).toEqual(["r3", "r1"]);
  });

  it("drops row ids that are not in the graph", () => {
    const nodes = graph("table", pagesize(10));
    const rows = frameRows({
      ...input(nodes),
      rowIds: ["r0", "ghost"],
    });
    expect(rows.rendered.map((n) => n.id)).toEqual(["r0"]);
  });

  it("returns nothing for an unknown frame", () => {
    const rows = rowsOf(new Map(), "missing");
    expect(rows.ordered).toEqual([]);
    expect(rows.rendered).toEqual([]);
  });
});

describe("frameRows in the list view", () => {
  it("applies the frame's view filters", () => {
    const nodes = graph("list", {
      [SYSTEM_IDS.viewFilterField]: [{ t: "str", v: `{:field f_status :eq "s0"}` }],
    });
    expect(rowsOf(nodes).rendered.map((n) => n.id)).toEqual(["r0", "r2", "r4"]);
  });

  it("keeps the children's order: the list declares no sort", () => {
    const nodes = graph("list", {
      [SYSTEM_IDS.viewSortField]: [{ t: "ref", v: SYSTEM_IDS.nodeTextField }],
      [SYSTEM_IDS.viewSortDirField]: [{ t: "str", v: "desc" }],
    });
    expect(rowsOf(nodes).rendered.map((n) => n.id)).toEqual(["r0", "r1", "r2", "r3", "r4"]);
  });

  it("is empty for an unknown frame", () => {
    expect(rowsOf(new Map(), "missing").rendered).toEqual([]);
  });
});

describe("contextual references act as their targets in views", () => {
  const ctxRef = (id: string, targetId: string): OutlineNode =>
    node(id, "", { [SYSTEM_IDS.refTargetField]: [{ t: "ref", v: targetId }] });

  function refGraph(view: FrameViewName, settings: OutlineNode["props"]): NodeMap {
    const map = new Map<string, OutlineNode>();
    map.set("f_stage", node("f_stage", "stage", {}, ["o_todo", "o_done"]));
    map.set("o_todo", node("o_todo", "todo"));
    map.set("o_done", node("o_done", "done"));
    map.set("f_prio", node("f_prio", "priority"));
    map.set("f_due", node("f_due", "due"));
    map.set(
      "t_task",
      node("t_task", "task", {
        [SYSTEM_IDS.fieldsField]: [
          { t: "ref", v: "f_stage" },
          { t: "ref", v: "f_prio" },
        ],
      }),
    );

    // Targets live outside the frame; the frame holds only contextual references to them.
    const tA: OutlineNode = {
      ...node("t_a", "Zebra", {
        [SYSTEM_IDS.typeField]: [{ t: "ref", v: "t_task" }],
        f_stage: [{ t: "ref", v: "o_done" }],
        f_prio: [{ t: "num", v: 2 }],
        f_due: [{ t: "str", v: "2026-11-20" }],
      }),
      tags: [{ id: "t_task", name: "task", color: "" }],
    };
    const tB: OutlineNode = {
      ...node("t_b", "Alpha", {
        [SYSTEM_IDS.typeField]: [{ t: "ref", v: "t_task" }],
        f_stage: [{ t: "ref", v: "o_todo" }],
        f_prio: [{ t: "num", v: 1 }],
        f_due: [{ t: "str", v: "2026-11-21" }],
      }),
      tags: [{ id: "t_task", name: "task", color: "" }],
    };
    map.set(tA.id, tA);
    map.set(tB.id, tB);
    map.set("ref_a", ctxRef("ref_a", "t_a"));
    map.set("ref_b", ctxRef("ref_b", "t_b"));

    const [frame, viewNode] = framedAs(
      node("frame", "Frame", {}, ["ref_a", "ref_b"]),
      view,
      settings,
    );
    map.set(frame.id, frame);
    map.set(viewNode.id, node(viewNode.id, "", viewNode.props));
    return map;
  }

  it("filters references by their target's fields and returns reference row ids", () => {
    const nodes = refGraph("table", {
      [SYSTEM_IDS.viewFilterField]: [{ t: "str", v: `{:field f_stage :eq o_done}` }],
    });
    expect(rowsOf(nodes).rendered.map((n) => n.id)).toEqual(["ref_a"]);
  });

  it("sorts references by their target's fields and text while returning reference row ids", () => {
    const byPrio = refGraph("table", {
      [SYSTEM_IDS.viewSortField]: [{ t: "ref", v: "f_prio" }],
      [SYSTEM_IDS.viewSortDirField]: [{ t: "str", v: "asc" }],
    });
    expect(rowsOf(byPrio).rendered.map((n) => n.id)).toEqual(["ref_b", "ref_a"]);

    const byName = refGraph("table", {
      [SYSTEM_IDS.viewSortField]: [{ t: "ref", v: SYSTEM_IDS.nodeTextField }],
      [SYSTEM_IDS.viewSortDirField]: [{ t: "str", v: "asc" }],
    });
    expect(rowsOf(byName).rendered.map((n) => n.id)).toEqual(["ref_b", "ref_a"]);
  });

  it("derives table columns from a reference target's tags", () => {
    const nodes = refGraph("table", {});
    const schema = schemaFor(nodes);
    const cols = resolveTableColumns({ display: [] }, rowsOf(nodes).ordered, schema);
    expect(cols.map((c) => c.fieldId)).toEqual(["f_stage", "f_prio"]);
  });

  it("groups references in a board by their target's field while keeping reference row ids", () => {
    const nodes = refGraph("board", {
      [SYSTEM_IDS.viewGroupField]: [{ t: "ref", v: "f_stage" }],
    });
    const rows = frameRows(input(nodes));
    expect(rows.columns.map((c) => [c.key, c.nodes.map((n) => n.id)])).toEqual([
      ["ref:o_todo", ["ref_b"]],
      ["ref:o_done", ["ref_a"]],
      ["__empty__", []],
    ]);
  });

  it("groups references in a calendar by their target's date field while keeping reference row ids", () => {
    const nodes = refGraph("calendar", {
      [SYSTEM_IDS.viewDateField]: [{ t: "ref", v: "f_due" }],
      [SYSTEM_IDS.viewSpanField]: [{ t: "str", v: "week" }],
    });
    const rows = frameRows({ ...input(nodes), day: "2026-11-20" });
    const held = rows.columns
      .filter((c) => c.nodes.length > 0)
      .map((c) => [c.key, c.nodes.map((n) => n.id)]);
    expect(held).toEqual([
      ["str:2026-11-20", ["ref_a"]],
      ["str:2026-11-21", ["ref_b"]],
    ]);
  });
});
