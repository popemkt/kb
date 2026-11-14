/**
 * A board with no group field lays its rows out as lanes (DESIGN-UI.md →
 * Lanes): each row heads a column and holds its children as the list does,
 * the walk nests them as a list's, and the keys follow, with the lane as the
 * outer level: ↑/↓ within and on, ←/→ between heads, Enter in, Esc out.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import type { Window } from "happy-dom";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  childInstanceKey,
  outlineInstanceKey,
  providedFrameViews,
  schemaOf,
  syncUiPlugins,
} from "@kb/ui-sdk";
import type { WireNode } from "@kb/contracts";
import { installDomGlobals } from "@kb/ui-test-kit";
import {
  collectVisibleInstances,
  FrameViewSlot,
  outlineNodes,
  useOutlineStore,
  useSelectionKeymap,
} from "@kb/outline-ui";
import { collectionsUiPlugin } from "@kb/collections-ui";
import { fixtureGraph } from "@/api/fixture-graph";
import { framedAs, viewFieldNodes } from "@/fixtures/view-fields";
import { useGraphStore } from "@/stores/graph.store";
import { resetOutlineStore } from "@/test-support/outline-store";
import { syncPagePlugins } from "@/test-support/page-plugins";
import { outlineUiPlugin } from "@/test-support/outline-plugin";

beforeAll(() => syncPagePlugins([outlineUiPlugin, collectionsUiPlugin]));
afterAll(() => syncUiPlugins([]));

function row(id: string, text: string, children: string[] = []): WireNode {
  return { id, text, props: {}, children, createdAt: "", updatedAt: "" };
}

/** A board with no group field over three lanes: L1 holds a1 and a2, L2 holds b1, L3 none. */
const LANES: WireNode[] = [
  ...viewFieldNodes,
  ...framedAs(row("board", "Board", ["L1", "L2", "L3"]), "board", {}),
  row("L1", "Lane one", ["a1", "a2"]),
  row("a1", "First in one"),
  row("a2", "Second in one"),
  row("L2", "Lane two", ["b1"]),
  row("b1", "First in two"),
  row("L3", "Lane three"),
];

const key = (id: string) => outlineInstanceKey(id, outlineNodes());
const under = (lane: string, id: string) => childInstanceKey(key(lane), id);

/** The selection now: its node and instance. */
function selected() {
  const { selectedNodeId, selectedInstanceKey } = useOutlineStore.getState();
  return [selectedNodeId, selectedInstanceKey];
}

function Host() {
  useSelectionKeymap();
  return null;
}

describe("a board's lanes", () => {
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
    useGraphStore.getState().hydrateFromWire(LANES, 1, "fixtures");
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

  it("draw each row as a lane always showing its rows, in place of asking for a field", () => {
    const html = renderToStaticMarkup(createElement(FrameViewSlot, { frameId: "board", depth: 0 }));
    expect(html).toContain('data-lanes="true"');
    expect(html.match(/data-lane="/g)?.length).toBe(3);
    expect(html).not.toContain('data-board-empty="true"');
    // A lane is the row as the list draws it: its children under it.
    const one = html.slice(html.indexOf('data-lane="L1"'), html.indexOf('data-lane="L2"'));
    expect(one).toContain("Lane one");
    expect(one).toContain("First in one");
    expect(one).toContain("Second in one");
  });

  it("walk as a list nests: each head, then its rows, each marked with its lane", () => {
    const nodes = outlineNodes();
    const walked = collectVisibleInstances("board", {
      nodes,
      schema: schemaOf(useGraphStore.getState()),
      run: null,
      views: providedFrameViews().map((view) => view.key),
      chain: [],
      pages: {},
    });
    expect(walked.map((i) => i.nodeId)).toEqual(["L1", "a1", "a2", "L2", "b1", "L3"]);
    expect(walked.find((i) => i.nodeId === "a2")?.instanceKey).toBe(under("L1", "a2"));
    const lane = (id: string) => walked.find((i) => i.nodeId === id)?.lane;
    expect(lane("a1")?.head.nodeId).toBe("L1");
    expect(lane("L2")).toMatchObject({
      head: { nodeId: "L2" },
      before: { nodeId: "L1" },
      after: { nodeId: "L3" },
    });
    expect(lane("L1")?.before).toBeNull();
    expect(lane("L3")?.after).toBeNull();
  });

  /** Select `id` at `instanceKey` and mount the window keymap. */
  function selectAt(id: string, instanceKey: string): void {
    act(() => useOutlineStore.getState().selectNode(id, instanceKey));
    act(() => root.render(createElement(Host)));
  }

  async function press(keyName: string): Promise<void> {
    await act(async () => {
      dom.document.body.dispatchEvent(
        new dom.KeyboardEvent("keydown", { key: keyName, bubbles: true, cancelable: true }),
      );
    });
  }

  it("← and → on a head move between lanes, and stop at either end", async () => {
    selectAt("L1", key("L1"));
    await press("ArrowRight");
    expect(selected()).toEqual(["L2", key("L2")]);
    await press("ArrowRight");
    expect(selected()).toEqual(["L3", key("L3")]);
    await press("ArrowRight");
    expect(selected()).toEqual(["L3", key("L3")]);
    await press("ArrowLeft");
    expect(selected()).toEqual(["L2", key("L2")]);
  });

  it("Enter goes into a lane's rows, ↑/↓ walk them and on, Esc comes out to the head", async () => {
    selectAt("L1", key("L1"));
    await press("Enter");
    expect(selected()).toEqual(["a1", under("L1", "a1")]);
    expect(useOutlineStore.getState().activeNodeId).toBeNull();
    await press("ArrowDown");
    expect(selected()).toEqual(["a2", under("L1", "a2")]);
    await press("ArrowDown");
    expect(selected()).toEqual(["L2", key("L2")]);
    await press("ArrowDown");
    expect(selected()).toEqual(["b1", under("L2", "b1")]);
    await press("Escape");
    expect(selected()).toEqual(["L2", key("L2")]);
    await press("Escape");
    expect(useOutlineStore.getState().selectedNodeId).toBeNull();
  });

  it("Enter on a lane with no rows edits its head, as on any row", async () => {
    selectAt("L3", key("L3"));
    await press("Enter");
    expect(useOutlineStore.getState().activeNodeId).toBe("L3");
  });

  it("inside a lane, ← climbs from a top row to its head, as in the list", async () => {
    selectAt("b1", under("L2", "b1"));
    await press("ArrowLeft");
    expect(useOutlineStore.getState().selectedNodeId).toBe("L2");
  });
});
