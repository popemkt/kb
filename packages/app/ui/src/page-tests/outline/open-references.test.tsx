/**
 * A reference in the text opens in place (DESIGN-UI.md → Contextual
 * references): Alt-click opens the target under its row as a projected row
 * and the pill says so; the keyboard walks it; it is the tab's alone, never
 * stored, and dropped once the text no longer names it. Expand reference…
 * and Remove reference… act on the references the row's text names.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Window } from "happy-dom";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { present } from "@kb/model";
import {
  EXPANSION_STORAGE_KEY,
  outlineInstanceKey,
  projectedRowKey,
  syncUiPlugins,
} from "@kb/ui-sdk";
import { mutations } from "@/actions/mutations";
import { useGraphStore } from "@/stores/graph.store";
import { useUiStore } from "@/stores/ui.store";
import { rankedFixture } from "@/test-support/ranked-fixture";
import { resetOutlineStore } from "@/test-support/outline-store";
import { syncPagePlugins } from "@/test-support/page-plugins";
import { NodeBlock, NodeCommandPalette, outlineNodes, useOutlineStore } from "@kb/outline-ui";
import { outlineUiPlugin } from "@/test-support/outline-plugin";

beforeAll(() => syncPagePlugins([outlineUiPlugin]));
afterAll(() => syncUiPlugins([]));

const ROW = "n.root-c";
const TEXT = "See [[n.root-b|Search]] and [[n.root-a]]";
const OPEN_B = projectedRowKey(ROW, "n.root-b");

describe("a reference in the text opens in place", () => {
  let dom: Window;
  let container: HTMLDivElement;
  let root: Root;

  beforeAll(() => {
    dom = new Window();
    const g = globalThis as Record<string, unknown>;
    g.window = dom;
    g.document = dom.document;
    g.HTMLElement = dom.HTMLElement;
    g.KeyboardEvent = dom.KeyboardEvent;
    g.MouseEvent = dom.MouseEvent;
    g.Node = dom.Node;
    g.localStorage = dom.localStorage;
    g.CSS = { escape: (s: string) => s };
    g.requestAnimationFrame = (fn: () => void) => {
      fn();
      return 0;
    };
  });

  beforeEach(async () => {
    resetOutlineStore();
    useUiStore.getState().setNodePaletteOpen(false);
    useGraphStore.getState().hydrateFromWire(rankedFixture(), 1, "fixtures");
    await act(async () => mutations.updateNodeContent(ROW, TEXT));
    container = dom.document.createElement("div") as unknown as HTMLDivElement;
    dom.document.body.appendChild(container as unknown as never);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    dom.document.body.innerHTML = "";
  });

  const rowKey = () => outlineInstanceKey(ROW, outlineNodes());

  async function draw(): Promise<void> {
    await act(async () => {
      root.render(<NodeBlock nodeId={ROW} instanceKey={rowKey()} depth={0} />);
    });
  }

  const pill = (id: string) =>
    present(
      container.querySelector<HTMLElement>(
        `[data-instance-key="${rowKey()}"] > div [data-kb-ref-id="${id}"]`,
      ),
      `pill ${id}`,
    );

  async function altClick(el: HTMLElement): Promise<void> {
    await act(async () => {
      el.dispatchEvent(
        new dom.MouseEvent("click", { bubbles: true, altKey: true }) as unknown as Event,
      );
    });
  }

  const drawnUnder = () =>
    [...container.querySelectorAll(`[data-node-block][data-instance-key^="ref:row:${ROW}/"]`)].map(
      (el) => el.getAttribute("data-node-id"),
    );

  it("Alt-click opens the target under the row as a projected row, and again closes it", async () => {
    await draw();
    await altClick(pill("n.root-b"));
    expect(drawnUnder()).toEqual(["n.root-b"]);
    expect(pill("n.root-b").getAttribute("aria-expanded")).toBe("true");
    expect(pill("n.root-a").getAttribute("aria-expanded")).toBeNull();
    // Nothing was written: the text is as it was.
    expect(outlineNodes().get(ROW)?.text).toBe(TEXT);

    await altClick(pill("n.root-b"));
    expect(drawnUnder()).toEqual([]);
    expect(pill("n.root-b").getAttribute("aria-expanded")).toBeNull();
  });

  it("draws open references in the order the text names them, and the keyboard walks them", async () => {
    await draw();
    await altClick(pill("n.root-a"));
    await altClick(pill("n.root-b"));
    expect(drawnUnder()).toEqual(["n.root-b", "n.root-a"]);
    const keys = useOutlineStore
      .getState()
      .getVisibleInstances()
      .map((row) => row.instanceKey);
    const at = keys.indexOf(rowKey());
    expect(keys.slice(at + 1, at + 3)).toEqual([OPEN_B, projectedRowKey(ROW, "n.root-a")]);
  });

  it("is the tab's alone: never stored", async () => {
    await draw();
    await altClick(pill("n.root-b"));
    expect(useOutlineStore.getState().expansion.get(OPEN_B)).toBe(true);
    expect(dom.localStorage.getItem(EXPANSION_STORAGE_KEY) ?? "").not.toContain("ref:row:");
  });

  it("is dropped once the row's text no longer names the reference", async () => {
    await draw();
    await altClick(pill("n.root-b"));
    await act(async () => mutations.updateNodeContent(ROW, "See [[n.root-a]]"));
    expect(useOutlineStore.getState().expansion.has(OPEN_B)).toBe(false);
  });

  it("under a projected row, Alt-click opens nothing in place", async () => {
    const projected = projectedRowKey("n.root-a", ROW);
    await act(async () => {
      root.render(<NodeBlock nodeId={ROW} instanceKey={projected} depth={1} />);
    });
    const ref = present(
      container.querySelector<HTMLElement>(
        `[data-instance-key="${projected}"] [data-kb-ref-id="n.root-b"]`,
      ),
      "pill",
    );
    await altClick(ref);
    expect(
      [...useOutlineStore.getState().expansion.keys()].filter((k) => k.startsWith("ref:row:")),
    ).toEqual([]);
  });

  it("edits the target in place: its text is the target's", async () => {
    await draw();
    await altClick(pill("n.root-b"));
    const open = present(
      container.querySelector(`[data-instance-key="${OPEN_B}"] .node-content`),
      "open reference",
    );
    expect(open.textContent).toContain("Search jumps to matching nodes");
  });

  describe("from the node menu", () => {
    async function openMenu(): Promise<void> {
      // Closed first, so it opens on its commands, as a fresh ⌘K does.
      await act(async () => root.render(<NodeCommandPalette open={false} onClose={() => {}} />));
      const anchor = dom.document.createElement("div");
      anchor.setAttribute("data-menu-anchor", rowKey());
      dom.document.body.appendChild(anchor);
      useOutlineStore.setState({ selectedNodeId: ROW, selectedInstanceKey: rowKey() });
      await act(async () => root.render(<NodeCommandPalette open onClose={() => {}} />));
    }

    const labels = () =>
      [...dom.document.querySelectorAll('[data-palette-list="true"] button')].map((b) =>
        b.textContent.trim(),
      );

    async function pick(label: string): Promise<void> {
      const button = [...dom.document.querySelectorAll('[data-palette-list="true"] button')].find(
        (b) => b.textContent.trim().startsWith(label),
      ) as HTMLElement | undefined;
      await act(async () => present(button, label).click());
    }

    it("Expand reference… lists the text's references, and a pick opens one", async () => {
      await openMenu();
      await pick("Expand reference…");
      expect(labels()).toEqual(["Search jumps to matching nodes", "Ship kb ui shell"]);
      await pick("Search jumps");
      expect(useOutlineStore.getState().expansion.get(OPEN_B)).toBe(true);

      await openMenu();
      await pick("Expand reference…");
      expect(labels()[0]).toContain("Expanded");
    });

    it("Remove reference… turns the reference picked into its label, in one text write", async () => {
      await openMenu();
      await pick("Remove reference…");
      await pick("Search jumps");
      await vi.waitFor(() =>
        expect(outlineNodes().get(ROW)?.text).toBe("See Search and [[n.root-a]]"),
      );
    });

    it("Remove reference… gives a bare reference its target's text", async () => {
      await openMenu();
      await pick("Remove reference…");
      await pick("Ship kb ui shell");
      await vi.waitFor(() =>
        expect(outlineNodes().get(ROW)?.text).toBe("See [[n.root-b|Search]] and Ship kb ui shell"),
      );
    });

    it("is not offered on a row whose text names no node", async () => {
      await act(async () => mutations.updateNodeContent(ROW, "Plain words"));
      await openMenu();
      expect(labels()).not.toContain("Expand reference…");
      expect(labels()).not.toContain("Remove reference…");
    });
  });
});
