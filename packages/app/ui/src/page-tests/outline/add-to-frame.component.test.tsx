/**
 * "+ Add" makes a row that belongs where it was asked for (DESIGN-UI.md →
 * Adding to a frame): a board's group adds its value, a view's filter adds
 * what it requires, lanes add a lane and end in their heads' create strips,
 * and a query's results add a node the query answers. Each is one write, so
 * one undo removes it, and the row opens its text and is transient.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import type { Window } from "happy-dom";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { syncUiPlugins } from "@kb/ui-sdk";
import type { WireNode } from "@kb/contracts";
import { present, SYSTEM_IDS, type PropValue } from "@kb/model";
import { installDomGlobals } from "@kb/ui-test-kit";
import { FrameViewSlot, QueryResultsSection, useOutlineStore } from "@kb/outline-ui";
import { collectionsUiPlugin } from "@kb/collections-ui";
import { OutlineListView } from "@kb/views";
import { fixtureGraph } from "@/api/fixture-graph";
import { mutations } from "@/actions/mutations";
import { framedAs, viewFieldNodes } from "@/fixtures/view-fields";
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

/** "Has tag task", as the query builder writes it. */
const TASK_EDN = '[:find ?id :where [?n :node/id ?id] [?t :node/id "t.task"] [?n :node/is ?t]]';

/** The fixture graph (its system fields seeded, the type field among them), and the frames. */
const GRAPH: WireNode[] = [
  ...fixtureGraph.nodes.filter((n) => !viewFieldNodes.some((v) => v.id === n.id)),
  ...viewFieldNodes,
  row("t.task", "task", { [SYSTEM_IDS.typeField]: [ref(SYSTEM_IDS.tag)] }),
  row(
    "f.status",
    "status",
    {
      [SYSTEM_IDS.typeField]: [ref(SYSTEM_IDS.field)],
      [SYSTEM_IDS.fieldTypeField]: [ref(SYSTEM_IDS.ftRef)],
      [SYSTEM_IDS.cardinalityField]: [ref(SYSTEM_IDS.cardinalityOne)],
    },
    ["o.open", "o.doing"],
  ),
  row("o.open", "Open"),
  row("o.doing", "Doing"),
  // A board grouped by status, its one row open.
  ...framedAs(row("groups", "Groups", {}, ["r1"]), "board", {
    [SYSTEM_IDS.viewGroupField]: [ref("f.status")],
  }),
  row("r1", "Open thing", { "f.status": [ref("o.open")] }),
  // A table filtered to status Doing.
  ...framedAs(row("doing", "Doing table"), "table", {
    [SYSTEM_IDS.viewFilterField]: [{ t: "str", v: '{:field f.status :eq "Doing"}' }],
  }),
  // Lanes: a board with no group field over one row with no rows of its own.
  ...framedAs(row("lanes", "Lanes", {}, ["L1"]), "board", {}),
  row("L1", "Lane one"),
  // A search for tasks.
  row("q", "Tasks", { [SYSTEM_IDS.queryField]: [{ t: "str", v: TASK_EDN }] }),
];

const wire = () => useGraphStore.getState().wireNodes;
const nodeOf = (id: string) => wire().find((n) => n.id === id);
const childrenOf = (id: string) => nodeOf(id)?.children ?? [];

describe("+ Add where a frame's rows are drawn", () => {
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
    container = dom.document.createElement("div") as unknown as HTMLDivElement;
    dom.document.body.appendChild(container as unknown as never);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    useGraphStore.getState().hydrateFromWire(fixtureGraph.nodes, fixtureGraph.rev, "fixtures");
  });

  function button(label: string): HTMLElement {
    return present(
      container.querySelector<HTMLElement>(`[data-add-row][aria-label="${label}"]`),
      `the "${label}" button`,
    );
  }

  async function click(label: string): Promise<void> {
    await act(async () => button(label).click());
  }

  it("a board's group adds a child of the frame holding the group's value, open and transient", async () => {
    await act(async () =>
      root.render(createElement(FrameViewSlot, { frameId: "groups", depth: 0 })),
    );
    expect(button("Add to Doing").tagName).toBe("BUTTON");
    await click("Add to Doing");
    const added = present(
      childrenOf("groups").find((id) => id !== "r1"),
      "the row the group added",
    );
    expect(nodeOf(added)?.props["f.status"]).toEqual([ref("o.doing")]);
    expect(useOutlineStore.getState().activeNodeId).toBe(added);
    expect(useOutlineStore.getState().transientIds.has(added)).toBe(true);

    // One write, one undo.
    await act(async () => {
      await mutations.undo();
    });
    expect(nodeOf(added)).toBeUndefined();
    expect(childrenOf("groups")).toEqual(["r1"]);
  });

  it("the No <field> group adds no value", async () => {
    await act(async () =>
      root.render(createElement(FrameViewSlot, { frameId: "groups", depth: 0 })),
    );
    await click("Add to No status");
    const added = present(
      childrenOf("groups").find((id) => id !== "r1"),
      "the added row",
    );
    expect(nodeOf(added)?.props["f.status"]).toBeUndefined();
  });

  it("a view's filter adds what it requires, its label read as the field's option", async () => {
    await act(async () =>
      root.render(createElement(FrameViewSlot, { frameId: "doing", depth: 0 })),
    );
    await click("Add a row");
    const [added] = childrenOf("doing");
    expect(nodeOf(present(added, "the added row"))?.props["f.status"]).toEqual([ref("o.doing")]);
  });

  it("lanes add a lane, and each lane ends in its head's create strip", async () => {
    const html = renderToStaticMarkup(createElement(FrameViewSlot, { frameId: "lanes", depth: 0 }));
    const lane = html.slice(html.indexOf('data-lane="L1"'));
    expect(lane).toContain('data-create-child-zone="L1"');

    await act(async () =>
      root.render(createElement(FrameViewSlot, { frameId: "lanes", depth: 0 })),
    );
    await click("Add a lane");
    expect(childrenOf("lanes")).toHaveLength(2);
  });

  it("a query's results add a node the query answers", async () => {
    await act(async () =>
      root.render(
        createElement(QueryResultsSection, {
          view: OutlineListView,
          nodeId: "q",
          depth: 0,
          renderNode: () => null,
        }),
      ),
    );
    await act(async () => {
      await useGraphStore.getState().queries?.settle((run) => run(TASK_EDN));
    });
    await click("Add a result");
    const tagged = () =>
      wire().filter((n) =>
        (n.props[SYSTEM_IDS.typeField] ?? []).some((v) => v.t === "ref" && v.v === "t.task"),
      );
    await vi.waitFor(() => expect(tagged()).toHaveLength(1));
    // Not a child of the query: where captures go.
    expect(childrenOf("q")).toEqual([]);
  });
});
