/**
 * A selection is a range of rows (DESIGN-UI.md → Outline editor): Shift+↑/↓
 * moves its head and keeps its anchor, any other move collapses it, and a
 * structural key acts on its top rows as one block, one write and one undo
 * step. Driven through the window keymap the way the app does; every
 * assertion waits on the state it reads.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Window } from "happy-dom";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { WireNode } from "@kb/contracts";
import { present, ranksFor, siblingSlots } from "@kb/model";
import { fixtureGraph } from "@/api/fixture-graph";
import { outlineInstanceKey, syncUiPlugins, WORKSPACE_ROOT_ID } from "@kb/ui-sdk";
import { installDomGlobals } from "@kb/ui-test-kit";
import { mutations } from "@/actions/mutations";
import { useGraphStore } from "@/stores/graph.store";
import { resetOutlineStore } from "@/test-support/outline-store";
import { syncPagePlugins } from "@/test-support/page-plugins";
import { NodeBlock, outlineNodes, useOutlineStore, useSelectionKeymap } from "@kb/outline-ui";
import { outlineUiPlugin } from "@/test-support/outline-plugin";

beforeAll(() => syncPagePlugins([outlineUiPlugin]));
afterAll(() => syncUiPlugins([]));

function Host() {
  useSelectionKeymap();
  return null;
}

const node = (id: string) => outlineNodes().get(id);
const selection = () => useOutlineStore.getState();
/** The forest's rows, in order, as far as these tests read it. */
const roots = () =>
  (node(WORKSPACE_ROOT_ID)?.children ?? []).filter((id) =>
    ["n.root-a", "n.root-b", "n.root-c"].includes(id),
  );

/**
 * The fixture graph with every row ranked, as a store ranks it: a restored
 * row takes a rank, and among unranked siblings it would sort first.
 */
function ranked(): WireNode[] {
  const nodes = structuredClone(fixtureGraph.nodes);
  const ranks = ranksFor(siblingSlots(nodes, null).map((n) => n.id));
  for (const parent of nodes)
    for (const [id, rank] of ranksFor(parent.children)) ranks.set(id, rank);
  return nodes.map((n) => ({ ...n, order: ranks.get(n.id) ?? n.order }));
}

describe("a selection is a range of rows", () => {
  let dom: Window;
  let restore: (() => void) | undefined;
  let container: HTMLDivElement;
  let root: Root;

  beforeAll(() => {
    const fresh = installDomGlobals();
    dom = fresh.window;
    restore = fresh.restore;
  });
  afterAll(() => restore?.());

  beforeEach(() => {
    resetOutlineStore();
    useGraphStore.getState().hydrateFromWire(ranked(), fixtureGraph.rev, "fixtures");
    container = dom.document.createElement("div") as unknown as HTMLDivElement;
    dom.document.body.appendChild(container as unknown as never);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function selectAndMount(nodeId: string): void {
    act(() => selection().selectNode(nodeId, outlineInstanceKey(nodeId, outlineNodes())));
    act(() => root.render(<Host />));
  }

  async function press(key: string, mods: { shiftKey?: boolean; metaKey?: boolean } = {}) {
    await act(async () => {
      dom.document.body.dispatchEvent(
        new dom.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...mods }),
      );
    });
  }

  it("Shift+↓ and Shift+↑ move the head and keep the anchor; a plain arrow collapses it", async () => {
    selectAndMount("n.root-a");
    await press("ArrowDown", { shiftKey: true });
    await press("ArrowDown", { shiftKey: true });
    expect(selection().selectedNodeIds).toEqual(["n.root-a", "n.root-b", "n.root-c"]);
    expect(selection().selectedNodeId).toBe("n.root-c");
    await press("ArrowUp", { shiftKey: true });
    expect(selection().selectedNodeIds).toEqual(["n.root-a", "n.root-b"]);
    expect(
      selection()
        .selectedRows()
        .map((row) => row.nodeId),
    ).toEqual(["n.root-a", "n.root-b"]);

    await press("ArrowDown");
    expect(selection().selectedNodeIds).toEqual(["n.root-c"]);
    expect(selection().selectionAnchorKey).toBeNull();
  });

  it("Shift-click moves the head to the row clicked, and every row between is drawn selected", async () => {
    selectAndMount("n.root-a");
    const rows = ["n.root-a", "n.root-b", "n.root-c"];
    act(() =>
      root.render(
        <>
          {rows.map((id) => (
            <NodeBlock
              key={id}
              nodeId={id}
              instanceKey={outlineInstanceKey(id, outlineNodes())}
              depth={0}
            />
          ))}
        </>,
      ),
    );
    const text = (id: string) =>
      present(
        container.querySelector(`[data-node-id="${id}"] .kb-md-view`),
        `${id}'s text`,
      ) as unknown as HTMLElement;
    await act(async () => {
      text("n.root-c").dispatchEvent(
        new dom.MouseEvent("click", { bubbles: true, cancelable: true, shiftKey: true }) as never,
      );
    });
    expect(selection().selectedNodeIds).toEqual(rows);
    expect(selection().activeNodeId).toBeNull();
    const drawn = [...container.querySelectorAll('[data-selected="true"]')].map((el) =>
      el.closest("[data-node-id]")?.getAttribute("data-node-id"),
    );
    expect(new Set(drawn)).toEqual(new Set(rows));
  });

  it("extends upward past the anchor the same way", async () => {
    selectAndMount("n.root-c");
    await press("ArrowUp", { shiftKey: true });
    expect(selection().selectedNodeIds).toEqual(["n.root-b", "n.root-c"]);
    expect(selection().selectedNodeId).toBe("n.root-b");
  });

  it("Delete removes every top row as one write, and one undo brings them all back", async () => {
    selectAndMount("n.root-b");
    await press("ArrowDown", { shiftKey: true });
    await press("Backspace");
    await vi.waitFor(() => expect(node("n.root-b") ?? node("n.root-c")).toBeUndefined());
    expect(useGraphStore.getState().undoStack).toHaveLength(1);
    await act(() => mutations.undo());
    await vi.waitFor(() => expect(roots()).toEqual(["n.root-a", "n.root-b", "n.root-c"]));
  });

  it("Tab puts the block under the row before it, in order, kept selected, in one undo step", async () => {
    selectAndMount("n.root-b");
    await press("ArrowDown", { shiftKey: true });
    await press("Tab");
    await vi.waitFor(() =>
      expect(node("n.root-a")?.children).toEqual([
        "n.child-a1",
        "n.child-a2",
        "n.root-b",
        "n.root-c",
      ]),
    );
    expect(selection().selectedNodeIds).toEqual(["n.root-b", "n.root-c"]);
    expect(useGraphStore.getState().undoStack).toHaveLength(1);
    await act(() => mutations.undo());
    await vi.waitFor(() => expect(node("n.root-b")?.parentId).not.toBe("n.root-a"));
    expect(node("n.root-c")?.parentId).not.toBe("n.root-a");
  });

  it("the moves carry the block past the sibling beside it", async () => {
    selectAndMount("n.root-b");
    await press("ArrowDown", { shiftKey: true });
    await press("ArrowUp", { metaKey: true, shiftKey: true });
    await vi.waitFor(() => expect(roots()).toEqual(["n.root-b", "n.root-c", "n.root-a"]));
    expect(selection().selectedNodeIds).toEqual(["n.root-b", "n.root-c"]);
  });

  it("leaves a range that is not one run of siblings where it is", async () => {
    act(() => selection().toggleCollapse("n.root-a"));
    selectAndMount("n.child-a2");
    // a2 is collapsed over its child, so the next row down is n.root-b.
    await press("ArrowDown", { shiftKey: true });
    expect(selection().selectedNodeIds).toEqual(["n.child-a2", "n.root-b"]);
    await press("Tab");
    expect(node("n.child-a2")?.parentId).toBe("n.root-a");
    expect(node("n.root-b")?.parentId).not.toBe("n.child-a1");
    expect(useGraphStore.getState().undoStack).toHaveLength(0);
  });
});
