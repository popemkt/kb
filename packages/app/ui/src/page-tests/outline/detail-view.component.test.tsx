/**
 * A frame shown as a list with detail (DESIGN-UI.md → List with detail): its
 * rows on the left, one row's page on the right, the first until the
 * selection chooses another; the page holds the row's fields and children,
 * and the walk nests those children after the row it shows, so the keys
 * reach them as they reach an open row's.
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
import { present, SYSTEM_IDS } from "@kb/model";
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

function row(
  id: string,
  text: string,
  children: string[] = [],
  props: WireNode["props"] = {},
): WireNode {
  return { id, text, props, children, createdAt: "", updatedAt: "" };
}

/** Notes shown as a list with detail: n1 holds c1 and c2, n2 holds d1 and a note field, n3 none. */
const DETAIL: WireNode[] = [
  ...fixtureGraph.nodes.filter((n) => !viewFieldNodes.some((v) => v.id === n.id)),
  ...viewFieldNodes,
  row("f.note", "note", [], {
    [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.field }],
  }),
  ...framedAs(row("notes", "Notes", ["n1", "n2", "n3"]), "detail", {}),
  row("n1", "First note", ["c1", "c2"]),
  row("c1", "Inside first"),
  row("c2", "Also inside first"),
  row("n2", "Second note", ["d1"], { "f.note": [{ t: "str", v: "a remark" }] }),
  row("d1", "Inside second"),
  row("n3", "Third note"),
];

const key = (id: string) => outlineInstanceKey(id, outlineNodes());
const under = (parent: string, id: string) => childInstanceKey(key(parent), id);

function walk(): string[] {
  return collectVisibleInstances("notes", {
    nodes: outlineNodes(),
    schema: schemaOf(useGraphStore.getState()),
    run: null,
    views: providedFrameViews().map((view) => view.key),
    chain: [],
    pages: {},
    details: useOutlineStore.getState().frameDetails,
    days: {},
    today: "2026-11-14",
  }).map((i) => i.nodeId);
}

function Host() {
  useSelectionKeymap();
  return createElement(FrameViewSlot, { frameId: "notes", depth: 0 });
}

describe("a list with detail", () => {
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
    useGraphStore.getState().hydrateFromWire(structuredClone(DETAIL), 1, "fixtures");
    useGraphStore.getState().zoomTo("notes");
    container = dom.document.createElement("div") as unknown as HTMLDivElement;
    dom.document.body.appendChild(container as unknown as never);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    useGraphStore.getState().hydrateFromWire(fixtureGraph.nodes, fixtureGraph.rev, "fixtures");
  });

  const page = () =>
    present(container.querySelector<HTMLElement>("[data-detail-page]"), "the detail page");

  it("lists every row and shows the first row's page, its children in it", () => {
    const html = renderToStaticMarkup(createElement(FrameViewSlot, { frameId: "notes", depth: 0 }));
    expect(html.match(/data-detail-row="/g)?.length).toBe(3);
    const shown = html.slice(html.indexOf('data-detail-page="n1"'));
    expect(shown).toContain("First note");
    expect(shown).toContain("Inside first");
    expect(shown).toContain("Also inside first");
    expect(html).not.toContain("Inside second");
    expect(html).toContain('aria-label="Add a row"');
  });

  it("follows the selection: the row chosen in the list is the one its page shows", async () => {
    await act(async () => root.render(createElement(Host)));
    expect(page().dataset.detailPage).toBe("n1");
    await act(async () => useOutlineStore.getState().selectNode("n2", key("n2")));
    expect(page().dataset.detailPage).toBe("n2");
    expect(page().getAttribute("aria-label")).toBe("Second note");
    expect(page().textContent).toContain("note");
    expect(page().textContent).toContain("Inside second");
    expect(container.querySelector('[data-detail-row="n2"]')?.getAttribute("data-shown")).toBe(
      "true",
    );
    // Selecting a row of the page keeps the page: only the list's rows choose it.
    await act(async () => useOutlineStore.getState().selectNode("d1", under("n2", "d1")));
    expect(page().dataset.detailPage).toBe("n2");
  });

  it("walks the shown row's children after it, so ↓ goes into its page and on", async () => {
    expect(walk()).toEqual(["n1", "c1", "c2", "n2", "n3"]);
    act(() => useOutlineStore.getState().showDetail("notes", "n2"));
    expect(walk()).toEqual(["n1", "n2", "d1", "n3"]);

    await act(async () => root.render(createElement(Host)));
    await act(async () => useOutlineStore.getState().selectNode("n2", key("n2")));
    const press = async (name: string) =>
      act(async () => {
        dom.document.body.dispatchEvent(
          new dom.KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }),
        );
      });
    await press("ArrowDown");
    expect(useOutlineStore.getState().selectedInstanceKey).toBe(under("n2", "d1"));
    await press("ArrowDown");
    expect(useOutlineStore.getState().selectedNodeId).toBe("n3");
    expect(page().dataset.detailPage).toBe("n3");
  });

  it("a shown row that goes away gives its place back to the first", async () => {
    act(() => useOutlineStore.getState().showDetail("notes", "gone"));
    await act(async () => root.render(createElement(Host)));
    expect(page().dataset.detailPage).toBe("n1");
  });
});
