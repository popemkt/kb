import { Window } from "happy-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EMPTY_EDITOR, type PageEditor } from "@kb/ui-sdk";
import { fixtureGraph } from "@/api/fixture-graph";
import { browserReplica } from "@/session/runtime";
import { useGraphStore } from "@/stores/graph.store";
import { providePageEditor } from "@/stores/page-editor";
import { carryPage, idleNow, restoreCarried } from "./reload";

/** A tab's session storage, kept across the reload. */
function storage() {
  const kept = new Map<string, string>();
  return {
    kept,
    getItem: (key: string) => kept.get(key) ?? null,
    setItem: (key: string, value: string) => void kept.set(key, value),
    removeItem: (key: string) => void kept.delete(key),
  };
}

/** A pane's scroll region, `height` tall inside, scrolled to `top`. */
function region(dom: Window, height: number, top = 0): HTMLElement {
  const main = dom.document.createElement("main");
  main.setAttribute("data-main-region", "scroll");
  Object.defineProperty(main, "scrollHeight", { configurable: true, value: height });
  Object.defineProperty(main, "clientHeight", { configurable: true, value: 100 });
  main.scrollTop = top;
  dom.document.body.append(main);
  return main as unknown as HTMLElement;
}

describe("the page a reload leaves and the one it lands on", () => {
  let dom: Window;
  const activated: Array<[string, number | undefined, string | undefined]> = [];
  const editor = (active: { nodeId: string; instanceKey: string } | null): PageEditor => ({
    ...EMPTY_EDITOR,
    getState: () => ({
      ...EMPTY_EDITOR.getState(),
      activeNodeId: active?.nodeId ?? null,
      activeInstanceKey: active?.instanceKey ?? null,
      activateNode: (nodeId, at, instanceKey) => void activated.push([nodeId, at, instanceKey]),
    }),
  });

  beforeEach(() => {
    dom = new Window();
    activated.length = 0;
    vi.stubGlobal("document", dom.document);
    vi.stubGlobal("window", dom);
    vi.stubGlobal("HTMLElement", dom.HTMLElement);
    vi.stubGlobal("HTMLInputElement", dom.HTMLInputElement);
    vi.stubGlobal("HTMLTextAreaElement", dom.HTMLTextAreaElement);
    vi.stubGlobal("requestAnimationFrame", (step: () => void) => setTimeout(step, 0));
    useGraphStore.getState().hydrateFromWire(structuredClone(fixtureGraph.nodes), 1, "api");
  });
  afterEach(() => {
    providePageEditor(EMPTY_EDITOR);
    vi.unstubAllGlobals();
  });

  it("is idle only with no unconfirmed write and no draft open in a field", () => {
    expect(idleNow()).toBe(true);

    const hold = browserReplica()?.hold(["n.root-a"]);
    expect(idleNow()).toBe(false);
    if (hold) browserReplica()?.drop(hold);
    expect(idleNow()).toBe(true);

    const search = dom.document.createElement("input");
    dom.document.body.append(search);
    search.focus();
    expect(idleNow()).toBe(false);

    // A row's text is written as it is typed: editing one is no draft.
    const row = dom.document.createElement("div");
    row.className = "kb-text";
    row.contentEditable = "true";
    dom.document.body.append(row);
    row.focus();
    expect(idleNow()).toBe(true);
  });

  it("comes back scrolled where each pane was, with the caret where it was", async () => {
    const tab = storage();
    region(dom, 2000, 640);
    region(dom, 900, 120);
    const row = dom.document.createElement("div");
    row.className = "kb-text";
    row.contentEditable = "true";
    row.textContent = "Ship kb ui shell";
    dom.document.body.append(row);
    row.focus();
    providePageEditor(editor({ nodeId: "n.root-a", instanceKey: "tree/n.root-a" }));
    carryPage(tab);

    // The next page: the panes are drawn empty first, their rows a moment later.
    dom = new Window();
    vi.stubGlobal("document", dom.document);
    const first = region(dom, 0);
    const second = region(dom, 900);
    restoreCarried(tab);
    expect(tab.kept.size).toBe(0);
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(second.scrollTop).toBe(120);
    expect(first.scrollTop).toBe(0);
    expect(activated).toEqual([]);

    Object.defineProperty(first, "scrollHeight", { configurable: true, value: 2000 });
    const drawn = dom.document.createElement("div");
    drawn.setAttribute("data-instance-key", "tree/n.root-a");
    dom.document.body.append(drawn);
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(first.scrollTop).toBe(640);
    expect(activated).toEqual([["n.root-a", 0, "tree/n.root-a"]]);
  });

  it("puts the caret back only once the page has every pane it was carried with", async () => {
    const tab = storage();
    region(dom, 2000);
    region(dom, 900);
    const row = dom.document.createElement("div");
    row.className = "kb-text";
    row.contentEditable = "true";
    dom.document.body.append(row);
    row.focus();
    providePageEditor(editor({ nodeId: "n.root-a", instanceKey: "tree/n.root-a" }));
    carryPage(tab);

    // The next page draws its first pane, rows and all, before the layout of
    // two replaces it: a caret placed now would be lost with that first draw.
    dom = new Window();
    vi.stubGlobal("document", dom.document);
    region(dom, 2000);
    const drawn = dom.document.createElement("div");
    drawn.setAttribute("data-instance-key", "tree/n.root-a");
    dom.document.body.append(drawn);
    restoreCarried(tab);
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(activated).toEqual([]);

    region(dom, 900);
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(activated).toEqual([["n.root-a", 0, "tree/n.root-a"]]);
  });
});
