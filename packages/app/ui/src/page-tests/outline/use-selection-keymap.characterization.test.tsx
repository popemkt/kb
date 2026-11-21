/**
 * Characterization of the selection-mode dispatcher (closed gap
 * [[01M1MGCDRS0K28YBF1Q86YY61S]]).
 *
 * `mapSelectionKey` is pinned as a pure table in `selection-keymap.test.ts`;
 * this file pins the other half — what each action does to the store — by
 * driving the window keymap the way the app does. One case per
 * `SelectionKeyAction` variant, so the switch can become a record without the
 * store choreography inside a case going unwatched.
 */
import { act } from "react";
import { definePlugin } from "@kb/plugin";
import { createRoot, type Root } from "react-dom/client";
import type { Window } from "happy-dom";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { fixtureGraph } from "@/api/fixture-graph";
import {
  childInstanceKey,
  outlineInstanceKey,
  projectedRowKey,
  syncUiPlugins,
  WORKSPACE_ROOT_ID,
} from "@kb/ui-sdk";
import { REF_SEED_WIRES, ctxRefWire } from "@/fixtures/contextual-ref";
import { KeybindingPoint } from "@kb/contracts";
import { provideKeybinding } from "@kb/keybindings";
import { useGraphStore } from "@/stores/graph.store";
import { rankedFixture } from "@/test-support/ranked-fixture";
import { installDomGlobals } from "@kb/ui-test-kit";
import { resetOutlineStore, rowClosed, rowKey } from "@/test-support/outline-store";
import { syncPagePlugins } from "@/test-support/page-plugins";
import { outlineNodes, useOutlineStore, useSelectionKeymap } from "@kb/outline-ui";
import { outlineUiPlugin } from "@/test-support/outline-plugin";

// The outline runs as the app boots it: its frame views provided, and the
// store's row walk wired to them.
beforeAll(() => syncPagePlugins([outlineUiPlugin]));
afterAll(() => syncUiPlugins([]));

interface Mods {
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}

function Host() {
  useSelectionKeymap();
  return null;
}

function node(id: string) {
  return outlineNodes().get(id);
}

/**
 * Let React and the fire-and-forget mutation chains settle.
 *
 * Several rounds, not one: the outline's store writes go through
 * `void mutations.…().then(…)` chains, and under a loaded test run one tick
 * is not always enough for a chain to land before an assertion reads the
 * store — or, on the way out of a test, before the next one re-hydrates.
 */
async function settle(rounds = 4, delayMs = 0): Promise<void> {
  for (let i = 0; i < rounds; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    });
  }
}

describe("selection-mode dispatcher (characterization)", () => {
  let dom: Window;
  const installed = { restore: () => {} };
  let container: HTMLDivElement;
  let root: Root;

  beforeAll(() => {
    const fresh = installDomGlobals();
    dom = fresh.window;
    installed.restore = fresh.restore;
  });

  afterAll(() => {
    installed.restore();
  });

  beforeEach(() => {
    resetOutlineStore();
    useGraphStore
      .getState()
      .hydrateFromWire(structuredClone(fixtureGraph.nodes), fixtureGraph.rev, "fixtures");
    container = dom.document.createElement("div") as unknown as HTMLDivElement;
    dom.document.body.appendChild(container as unknown as never);
    root = createRoot(container);
  });

  afterEach(async () => {
    // Generous on the way out: a delete whose promise is still in flight when
    // the next test re-hydrates would delete a row out of that test's graph.
    await settle(8, 1);
    act(() => root.unmount());
    container.remove();
  });

  /** Select `nodeId` at its outline instance and mount the window keymap. */
  function selectAndMount(nodeId: string): void {
    const instanceKey = outlineInstanceKey(nodeId, outlineNodes());
    act(() => {
      useOutlineStore.getState().selectNode(nodeId, instanceKey);
    });
    act(() => {
      root.render(<Host />);
    });
  }

  /** Press `key` on `target` (the page); whether the page took it (`defaultPrevented`). */
  async function press(
    key: string,
    mods: Mods = {},
    target: { dispatchEvent: (event: never) => boolean } = dom.document.body,
  ): Promise<boolean> {
    const ev = new dom.KeyboardEvent("keydown", {
      key,
      bubbles: true,
      cancelable: true,
      ...mods,
    });
    await act(async () => {
      target.dispatchEvent(ev as never);
    });
    await settle();
    return ev.defaultPrevented;
  }

  it("select: an arrow moves the selection to the neighbouring instance", async () => {
    selectAndMount("n.root-b");
    await press("ArrowDown");
    expect(useOutlineStore.getState().selectedNodeId).toBe("n.root-c");
    expect(useOutlineStore.getState().selectedInstanceKey).toBe(
      outlineInstanceKey("n.root-c", outlineNodes()),
    );
  });

  it("a focused control keeps its keys: Tab moves on and Enter presses it", async () => {
    selectAndMount("n.root-b");
    const parent = node("n.root-b")?.parentId;
    // A tag's box, a hidden field's chip: a control the keyboard stops at.
    const box = dom.document.createElement("div");
    box.setAttribute("role", "checkbox");
    box.tabIndex = 0;
    const mark = dom.document.createElement("span");
    box.appendChild(mark);
    dom.document.body.appendChild(box);
    expect(await press("Tab", { shiftKey: true }, box)).toBe(false);
    expect(await press("Tab", {}, mark)).toBe(false);
    expect(await press("Enter", {}, box)).toBe(false);
    expect(await press(" ", {}, box)).toBe(false);
    expect(node("n.root-b")?.parentId).toBe(parent);
    expect(useOutlineStore.getState().activeNodeId).toBeNull();
    expect(useOutlineStore.getState().selectedNodeId).toBe("n.root-b");
    box.remove();
  });

  it("chrome the keyboard skips leaves its keys to the selection", async () => {
    selectAndMount("n.root-b");
    // The bullet: a button, but not a tab stop, so a click leaves focus on it.
    const bullet = dom.document.createElement("div");
    bullet.setAttribute("role", "button");
    bullet.tabIndex = -1;
    dom.document.body.appendChild(bullet);
    expect(await press("ArrowDown", {}, bullet)).toBe(true);
    expect(useOutlineStore.getState().selectedNodeId).toBe("n.root-c");
    bullet.remove();
  });

  it("clear: Escape drops the selection", async () => {
    selectAndMount("n.root-b");
    await press("Escape");
    expect(useOutlineStore.getState().selectedNodeId).toBeNull();
  });

  it("edit: Enter activates the row", async () => {
    selectAndMount("n.root-b");
    await press("Enter");
    expect(useOutlineStore.getState().activeNodeId).toBe("n.root-b");
  });

  it("toggleCollapse: Space flips the row open", async () => {
    selectAndMount("n.root-a");
    expect(rowClosed("n.root-a")).toBe(true);
    await press(" ");
    expect(rowClosed("n.root-a")).toBe(false);
  });

  it("collapse: ArrowLeft on an expanded parent closes it", async () => {
    act(() => useOutlineStore.getState().toggleCollapse(rowKey("n.root-a")));
    selectAndMount("n.root-a");
    await press("ArrowLeft");
    expect(rowClosed("n.root-a")).toBe(true);
  });

  it("expand: ArrowRight on a collapsed parent opens it", async () => {
    selectAndMount("n.root-a");
    await press("ArrowRight");
    expect(rowClosed("n.root-a")).toBe(false);
  });

  it("selectParent: ArrowLeft on a leaf climbs", async () => {
    act(() => useOutlineStore.getState().toggleCollapse(rowKey("n.root-a")));
    selectAndMount("n.child-a1");
    await press("ArrowLeft");
    expect(useOutlineStore.getState().selectedNodeId).toBe("n.root-a");
  });

  it("selectFirstChild: ArrowRight on an expanded parent descends", async () => {
    act(() => useOutlineStore.getState().toggleCollapse(rowKey("n.root-a")));
    selectAndMount("n.root-a");
    await press("ArrowRight");
    expect(useOutlineStore.getState().selectedNodeId).toBe("n.child-a1");
  });

  it("indent: Tab reparents into the previous sibling", async () => {
    selectAndMount("n.root-b");
    await press("Tab");
    expect(node("n.root-b")?.parentId).toBe("n.root-a");
  });

  it("outdent: Shift+Tab lifts a child to the forest", async () => {
    act(() => useOutlineStore.getState().toggleCollapse(rowKey("n.root-a")));
    selectAndMount("n.child-a1");
    await press("Tab", { shiftKey: true });
    expect(node("n.child-a1")?.parentId).toBe(WORKSPACE_ROOT_ID);
  });

  it("moveUp: Meta+Shift+ArrowUp swaps with the previous sibling", async () => {
    act(() => useOutlineStore.getState().toggleCollapse(rowKey("n.root-a")));
    selectAndMount("n.child-a2");
    await press("ArrowUp", { metaKey: true, shiftKey: true });
    expect(node("n.root-a")?.children).toEqual(["n.child-a2", "n.child-a1"]);
  });

  it("moveDown: Meta+Shift+ArrowDown swaps with the next sibling", async () => {
    act(() => useOutlineStore.getState().toggleCollapse(rowKey("n.root-a")));
    selectAndMount("n.child-a1");
    await press("ArrowDown", { metaKey: true, shiftKey: true });
    expect(node("n.root-a")?.children).toEqual(["n.child-a2", "n.child-a1"]);
  });

  it("zoom: Meta+. enters the row", async () => {
    selectAndMount("n.root-b");
    await press(".", { metaKey: true });
    expect(useGraphStore.getState().rootNodeId).toBe("n.root-b");
  });

  it("createAfter: o on an expanded parent mints its first child", async () => {
    act(() => useOutlineStore.getState().toggleCollapse(rowKey("n.root-a")));
    selectAndMount("n.root-a");
    await press("o");
    const minted = useOutlineStore.getState().activeNodeId;
    expect(minted).not.toBeNull();
    expect(node("n.root-a")?.children).toEqual([minted, "n.child-a1", "n.child-a2"]);
  });

  it("createAfter: o on a top-level row mints the row directly below it", async () => {
    // The top level's order is its rows' ranks.
    useGraphStore.getState().hydrateFromWire(rankedFixture(), fixtureGraph.rev, "fixtures");
    selectAndMount("n.root-b");
    await press("o");
    const minted = useOutlineStore.getState().activeNodeId;
    const roots = node(WORKSPACE_ROOT_ID)?.children ?? [];
    expect(roots.slice(roots.indexOf("n.root-b"))).toEqual(["n.root-b", minted, "n.root-c"]);
  });

  it("createAfter: o on an expanded reference under a query result edits the new row there", async () => {
    // n.root-b, a result of query n.q, holds a reference to n.root-a, opened.
    const wires = structuredClone(fixtureGraph.nodes).map((w) =>
      w.id === "n.root-b" ? { ...w, children: ["n.ref-a"] } : w,
    );
    useGraphStore
      .getState()
      .hydrateFromWire(
        [...wires, ...REF_SEED_WIRES, ctxRefWire("n.ref-a", "n.root-a")],
        fixtureGraph.rev,
        "fixtures",
      );
    const instanceKey = childInstanceKey(projectedRowKey("n.q", "n.root-b"), "n.ref-a");
    act(() => useOutlineStore.getState().toggleCollapse(instanceKey));
    act(() => useOutlineStore.getState().selectNode("n.ref-a", instanceKey));
    act(() => root.render(<Host />));
    await press("o");
    const minted = String(useOutlineStore.getState().activeNodeId);
    expect(node(minted)?.parentId).toBe("n.root-a");
    expect(useOutlineStore.getState().activeInstanceKey).toBe(
      childInstanceKey(instanceKey, minted),
    );
  });

  it("createAfter: o on a leaf mints the next sibling", async () => {
    act(() => useOutlineStore.getState().toggleCollapse(rowKey("n.root-a")));
    selectAndMount("n.child-a1");
    await press("o");
    const minted = useOutlineStore.getState().activeNodeId;
    expect(minted).not.toBeNull();
    expect(node("n.root-a")?.children).toEqual(["n.child-a1", minted, "n.child-a2"]);
  });

  it("createBefore: O mints the row directly above", async () => {
    act(() => useOutlineStore.getState().toggleCollapse(rowKey("n.root-a")));
    selectAndMount("n.child-a2");
    await press("O");
    const minted = useOutlineStore.getState().activeNodeId;
    expect(minted).not.toBeNull();
    expect(node("n.root-a")?.children).toEqual(["n.child-a1", minted, "n.child-a2"]);
  });

  it("createBefore: O on a top-level row mints the row directly above it", async () => {
    // The top level's order is its rows' ranks.
    useGraphStore.getState().hydrateFromWire(rankedFixture(), fixtureGraph.rev, "fixtures");
    selectAndMount("n.root-c");
    await press("O");
    const minted = useOutlineStore.getState().activeNodeId;
    const roots = node(WORKSPACE_ROOT_ID)?.children ?? [];
    expect(roots.slice(roots.indexOf("n.root-b"))).toEqual(["n.root-b", minted, "n.root-c"]);
  });

  it("append: a printable key edits at the end with the character added", async () => {
    const before = node("n.root-b")?.text ?? "";
    selectAndMount("n.root-b");
    await press("x");
    expect(node("n.root-b")?.text).toBe(`${before}x`);
    expect(useOutlineStore.getState().activeNodeId).toBe("n.root-b");
  });

  it("delete: Backspace removes the row and selects its predecessor", async () => {
    selectAndMount("n.root-c");
    await press("Backspace");
    expect(node("n.root-c")).toBeUndefined();
    expect(useOutlineStore.getState().selectedNodeId).toBe("n.root-b");
  });

  it("an Alt chord another plugin binds runs, and one no binding claims stays native", async () => {
    const altZoom = definePlugin({
      name: "alt-keys",
      apply: (ctx) =>
        ctx.contribute(
          KeybindingPoint,
          provideKeybinding("zoom", {
            context: "outline.selection",
            chord: "Alt-z",
            run: { intent: "zoom" },
          }),
        ),
    });
    syncPagePlugins([outlineUiPlugin, altZoom]);
    try {
      selectAndMount("n.root-c");
      const before = node("n.root-c")?.text;
      expect(await press("o", { altKey: true })).toBe(false);
      expect(node("n.root-c")?.text).toBe(before);
      expect(useOutlineStore.getState().activeNodeId).toBeNull();
      expect(await press("z", { altKey: true })).toBe(true);
      expect(useGraphStore.getState().rootNodeId).toBe("n.root-c");
    } finally {
      syncPagePlugins([outlineUiPlugin]);
    }
  });

  it("an unmapped chord leaves the store alone", async () => {
    selectAndMount("n.root-b");
    const before = useGraphStore.getState().wireNodes.length;
    await press("F5");
    await press("k", { metaKey: true });
    expect(useGraphStore.getState().wireNodes.length).toBe(before);
    expect(useOutlineStore.getState().selectedNodeId).toBe("n.root-b");
    expect(useOutlineStore.getState().activeNodeId).toBeNull();
  });
});
