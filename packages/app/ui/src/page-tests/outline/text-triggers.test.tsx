/**
 * Triggers in the text (DESIGN-UI.md → Triggers in the text), in a row
 * being edited: what is typed opens the one picker at the caret, a pick
 * replaces what was typed for it, and what a trigger does with a pick is
 * its own.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Window } from "happy-dom";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { present } from "@kb/model";
import { outlineInstanceKey, syncUiPlugins } from "@kb/ui-sdk";
import { mutations } from "@/actions/mutations";
import { useGraphStore } from "@/stores/graph.store";
import { rankedFixture } from "@/test-support/ranked-fixture";
import { resetOutlineStore } from "@/test-support/outline-store";
import { syncPagePlugins } from "@/test-support/page-plugins";
import { NodeBlock, outlineNodes, useOutlineStore } from "@kb/outline-ui";
import { outlineUiPlugin } from "@/test-support/outline-plugin";

beforeAll(() => syncPagePlugins([outlineUiPlugin]));
afterAll(() => syncUiPlugins([]));

const ROW = "n.root-c";

/** The row's text, as the graph holds it. */
const textOf = (id: string) => outlineNodes().get(id)?.text;

describe("triggers in the text", () => {
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
    g.CSS = { escape: (s: string) => s };
  });

  beforeEach(() => {
    resetOutlineStore();
    useGraphStore.getState().hydrateFromWire(rankedFixture(), 1, "fixtures");
    container = dom.document.createElement("div") as unknown as HTMLDivElement;
    dom.document.body.appendChild(container as unknown as never);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  /** Edit the row with `text` in it, the caret at its end. */
  async function typed(text: string): Promise<HTMLElement> {
    await act(async () => mutations.updateNodeContent(ROW, text));
    const key = outlineInstanceKey(ROW, outlineNodes());
    act(() => useOutlineStore.getState().activateNode(ROW, text.length, key));
    await act(async () => {
      root.render(<NodeBlock nodeId={ROW} instanceKey={key} depth={0} />);
    });
    return present(
      container.querySelector<HTMLElement>(`[data-instance-key="${key}"] [contenteditable]`),
      "editor",
    );
  }

  /** The labels the open picker lists. */
  const listed = () =>
    [...container.querySelectorAll('[role="listbox"] [role="option"]')].map((o) =>
      o.textContent.trim(),
    );

  async function press(el: HTMLElement, key: string): Promise<boolean> {
    let prevented = false;
    await act(async () => {
      const ev = new dom.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
      el.dispatchEvent(ev as unknown as Event);
      prevented = ev.defaultPrevented;
    });
    return prevented;
  }

  describe("[[", () => {
    it("offers the nodes matching what follows, and a pick inserts a reference to one", async () => {
      const el = await typed("See [[Search jumps");
      expect(listed()[0]).toContain("Search jumps to matching nodes");
      expect(await press(el, "Enter")).toBe(true);
      expect(textOf(ROW)).toBe("See [[n.root-b|Search jumps to matching nodes]]");
      expect(container.querySelector('[role="listbox"]')).toBeNull();
    });
  });
});
