/**
 * The page title is edited as a row is: through the page editor, under its
 * own instance (`pageTitleInstanceKey`), so while the owner types in it the
 * page reports editing (`BrowserHost.editing()`, `PageActivity.editing`) and
 * the writes its keystrokes make are typing — never structural writes, which
 * a theme's art and a backdrop answer with a gesture.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Window } from "happy-dom";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  browserHost,
  pageTitleInstanceKey,
  syncUiPlugins,
  usePageActivity,
  type PageActivity,
} from "@kb/ui-sdk";
import { OutlineEditor, outlineUiPlugin, useOutlineStore } from "@kb/outline-ui";
import { setPostAction } from "@/api/action";
import { fixtureGraph } from "@/api/fixture-graph";
import { mutations, __resetPendingContentForTests } from "@/actions/mutations";
import { useGraphStore } from "@/stores/graph.store";
import { resetOutlineStore } from "@/test-support/outline-store";
import { syncPagePlugins } from "@/test-support/page-plugins";

const PAGE = "n.root-a";

/** Every activity the page reported, in order, as a backdrop is handed it. */
const seen: PageActivity[] = [];
function Probe() {
  const activity = usePageActivity();
  seen.push(activity);
  return null;
}

describe("the page title's edit", () => {
  let dom: Window;
  let container: HTMLDivElement;
  let root: Root;

  beforeAll(() => {
    syncPagePlugins([outlineUiPlugin]);
    dom = new Window();
    const g = globalThis as Record<string, unknown>;
    g.window = dom;
    g.document = dom.document;
    g.HTMLElement = dom.HTMLElement;
    g.KeyboardEvent = dom.KeyboardEvent;
    g.MouseEvent = dom.MouseEvent;
    g.Node = dom.Node;
    g.CSS = { escape: (s: string) => s };
    g.IS_REACT_ACT_ENVIRONMENT = true;
  });
  afterAll(() => syncUiPlugins([]));
  beforeEach(() => {
    resetOutlineStore();
    useGraphStore
      .getState()
      .hydrateFromWire(structuredClone(fixtureGraph.nodes), fixtureGraph.rev, "fixtures");
    __resetPendingContentForTests();
    setPostAction(null);
    seen.length = 0;
    container = dom.document.createElement("div") as unknown as HTMLDivElement;
    dom.document.body.appendChild(container as unknown as never);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("is the page's edit while the owner types in it: its keystrokes are typing, not structural writes", async () => {
    await act(async () => {
      root.render(
        <>
          <Probe />
          <OutlineEditor root={PAGE} />
        </>,
      );
    });
    const title = container.querySelector<HTMLElement>('[data-zoom-title="true"]');
    if (title === null) throw new Error("the page head drew no editable title");
    expect(browserHost().editing()).toBe(false);

    await act(async () => {
      title.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    expect(useOutlineStore.getState().activeInstanceKey).toBe(pageTitleInstanceKey(PAGE));
    expect(browserHost().editing()).toBe(true);

    const typedFrom = seen.length;
    for (let key = 1; key <= 30; key++) {
      await act(() => mutations.updateNodeContent(PAGE, `Page ${"x".repeat(key)}`));
    }
    const typed = seen.slice(typedFrom);
    expect(typed.at(-1)?.writes).toBeGreaterThan(seen[typedFrom - 1]?.writes ?? 0);
    // A structural write is one that lands while nobody is editing: none did.
    expect(typed.filter((activity) => !activity.editing)).toEqual([]);
    expect(browserHost().editing()).toBe(true);

    // Ending the edit (Enter) ends the page's edit with it.
    const editor = container.querySelector<HTMLElement>("[contenteditable]");
    if (editor === null) throw new Error("the title's editor is not open");
    await act(async () => {
      editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(browserHost().editing()).toBe(false);
    expect(container.querySelector('[data-zoom-title="true"]')).not.toBeNull();
  });
});
