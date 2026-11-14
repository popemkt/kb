/**
 * A row moves to the group beside its own with ⌘⇧← and ⌘⇧→ (DESIGN-UI.md →
 * Groups): the walk says which groups are beside a row's, skipping folded
 * ones, the move is one page write, and the selection stays on the row. Over a
 * range every selected row moves one group over from its own, in one write. A
 * query's results do not move.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Window } from "happy-dom";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  frameRows,
  frameViewOf,
  outlineInstanceKey,
  providedFrameViews,
  schemaOf,
  syncUiPlugins,
} from "@kb/ui-sdk";
import type { WireNode } from "@kb/contracts";
import { present, SYSTEM_IDS, type PropValue } from "@kb/model";
import { installDomGlobals } from "@kb/ui-test-kit";
import {
  collectVisibleInstances,
  outlineNodes,
  useOutlineStore,
  useSelectionKeymap,
} from "@kb/outline-ui";
import { collectionsUiPlugin } from "@kb/collections-ui";
import { fixtureGraph } from "@/api/fixture-graph";
import { framedAs, viewFieldNodes } from "@/fixtures/view-fields";
import { mutations } from "@/actions/mutations";
import { useGraphStore } from "@/stores/graph.store";
import { resetOutlineStore } from "@/test-support/outline-store";
import { syncPagePlugins } from "@/test-support/page-plugins";
import { outlineUiPlugin } from "@/test-support/outline-plugin";

beforeAll(() => syncPagePlugins([outlineUiPlugin, collectionsUiPlugin]));
afterAll(() => syncUiPlugins([]));

const AT = "2026-11-14T00:00:00.000Z";
const ref = (v: string): PropValue => ({ t: "ref", v });

function row(id: string, text: string, props: WireNode["props"] = {}, children: string[] = []) {
  return { id, text, props, children, createdAt: AT, updatedAt: AT } satisfies WireNode;
}

/** A board grouped by status (Todo, Doing, Done, Blocked), Done folded. */
const GRAPH: WireNode[] = [
  ...fixtureGraph.nodes.filter((n) => !viewFieldNodes.some((v) => v.id === n.id)),
  ...viewFieldNodes,
  row(
    "f.status",
    "status",
    {
      [SYSTEM_IDS.typeField]: [ref(SYSTEM_IDS.field)],
      [SYSTEM_IDS.fieldTypeField]: [ref(SYSTEM_IDS.ftRef)],
    },
    ["o.todo", "o.doing", "o.done", "o.blocked"],
  ),
  row("o.todo", "Todo"),
  row("o.doing", "Doing"),
  row("o.done", "Done"),
  row("o.blocked", "Blocked"),
  ...framedAs(row("board", "Board", {}, ["c1", "c3", "c2"]), "board", {
    [SYSTEM_IDS.viewGroupField]: [ref("f.status")],
    [SYSTEM_IDS.viewCollapsedField]: [{ t: "str", v: "ref:o.done" }],
  }),
  row("c1", "First", { "f.status": [ref("o.todo")] }),
  row("c2", "Second", { "f.status": [ref("o.doing")] }),
  row("c3", "Third", { "f.status": [ref("o.todo")] }),
];

/** The instance key of the row `id` is drawn at. */
const keyOf = (id: string) => outlineInstanceKey(id, outlineNodes());
const statusOf = (id: string) =>
  useGraphStore.getState().wireNodes.find((n) => n.id === id)?.props["f.status"];

function walk() {
  return collectVisibleInstances("board", {
    nodes: outlineNodes(),
    schema: schemaOf(useGraphStore.getState()),
    run: null,
    views: providedFrameViews().map((view) => view.key),
    chain: [],
    pages: {},
    expansion: new Map(),
    details: {},
    days: {},
    today: "2026-11-14",
  });
}

function Host() {
  useSelectionKeymap();
  return null;
}

describe("a row's group keys", () => {
  let dom: Window;
  const installed = { restore: () => {} };
  let container: HTMLDivElement;
  let root: Root;

  beforeAll(() => {
    const fresh = installDomGlobals();
    dom = fresh.window;
    installed.restore = fresh.restore;
  });
  afterAll(() => installed.restore());

  beforeEach(() => {
    resetOutlineStore();
    useGraphStore.getState().hydrateFromWire(structuredClone(GRAPH), 1, "fixtures");
    useGraphStore.getState().zoomTo("board");
    container = dom.document.createElement("div") as unknown as HTMLDivElement;
    dom.document.body.appendChild(container as unknown as never);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    useGraphStore.getState().hydrateFromWire(fixtureGraph.nodes, fixtureGraph.rev, "fixtures");
  });

  it("are walked from the groups the board draws, past folded ones, none past an end", () => {
    const group = (id: string) => walk().find((i) => i.nodeId === id)?.group;
    expect(group("c1")).toEqual({
      frameId: "board",
      fieldId: "f.status",
      before: null,
      after: { value: ref("o.doing") },
    });
    // Done is folded, so Doing's next group is Blocked.
    expect(group("c2")).toEqual({
      frameId: "board",
      fieldId: "f.status",
      before: { value: ref("o.todo") },
      after: { value: ref("o.blocked") },
    });
  });

  async function pressOn(id: string, keyName: string): Promise<void> {
    const at = outlineInstanceKey(id, outlineNodes());
    act(() => useOutlineStore.getState().selectNode(id, at));
    await press(keyName);
  }

  async function press(keyName: string): Promise<void> {
    act(() => root.render(createElement(Host)));
    await act(async () => {
      dom.document.body.dispatchEvent(
        new dom.KeyboardEvent("keydown", {
          key: keyName,
          metaKey: true,
          ctrlKey: true,
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
  }

  it("move the selected row into the group beside it in one write, the selection staying", async () => {
    await pressOn("c1", "ArrowRight");
    expect(statusOf("c1")).toEqual([ref("o.doing")]);
    expect(useOutlineStore.getState().selectedNodeId).toBe("c1");
    // Doing's next unfolded group is Blocked; Done is skipped.
    await pressOn("c1", "ArrowRight");
    expect(statusOf("c1")).toEqual([ref("o.blocked")]);
    await pressOn("c2", "ArrowLeft");
    expect(statusOf("c2")).toEqual([ref("o.todo")]);
  });

  it("move every row of a range in one column to the next group, in one undo step, the range staying", async () => {
    act(() => useOutlineStore.getState().selectNode("c1", keyOf("c1")));
    act(() => useOutlineStore.getState().extendSelection({ instanceKey: keyOf("c3") }));
    expect(useOutlineStore.getState().selectedNodeIds).toEqual(["c1", "c3"]);
    await press("ArrowRight");
    expect(statusOf("c1")).toEqual([ref("o.doing")]);
    expect(statusOf("c3")).toEqual([ref("o.doing")]);
    expect(statusOf("c2")).toEqual([ref("o.doing")]);
    expect(useGraphStore.getState().undoStack).toHaveLength(1);
    expect(useOutlineStore.getState().selectedNodeIds).toEqual(["c1", "c3"]);
    await act(() => mutations.undo());
    expect(statusOf("c1")).toEqual([ref("o.todo")]);
    expect(statusOf("c3")).toEqual([ref("o.todo")]);
  });

  it("do nothing past the first group", async () => {
    await pressOn("c1", "ArrowLeft");
    expect(statusOf("c1")).toEqual([ref("o.todo")]);
  });

  it("are not offered for a query's results, which do not move", () => {
    const nodes = outlineNodes();
    const schema = schemaOf(useGraphStore.getState());
    const views = providedFrameViews().map((view) => view.key);
    const view = present(frameViewOf(present(nodes.get("board"), "board"), schema, views), "view");
    const rows = (rowIds?: string[]) =>
      frameRows({ frameId: "board", nodes, schema, view, rowIds });
    expect(rows().steps.size).toBe(3);
    expect(rows(["c1", "c2"]).steps.size).toBe(0);
  });
});
