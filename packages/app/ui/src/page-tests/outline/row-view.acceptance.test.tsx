/**
 * A row drawn as the view its tag names (DESIGN-UI.md → Row views), in the
 * outline as the app draws it: a node whose tag names a view in
 * `sys.f.view.row` is drawn as that view at placement `row`, handed its row,
 * while no one edits it; pressing its text edits the row as text, in the
 * outline's own text host; and a row whose tag names no such view, or one
 * this page does not draw at `row`, is its text. The same holds for a
 * repository extension's row view, loaded from the bytes a server serves
 * (`loadExamplePageHalf`) and claimed for its tag by the seed fold.
 */
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Effect } from "effect";
import { Window } from "happy-dom";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ViewKeyPoint, type WireNode } from "@kb/contracts";
import { BUNDLED_DECLARATIONS } from "@kb/bundled";
import { SYSTEM_IDS, foldSeed, viewOptionId } from "@kb/model";
import { definePlugin } from "@kb/plugin";
import { NoParams, viewKey } from "@kb/views";
import { provideView, syncUiPlugins, ViewPoint, type ViewProps } from "@kb/ui-sdk";
import { OutlineEditor, outlineUiPlugin, useOutlineStore } from "@kb/outline-ui";
import { setPostAction } from "@/api/action";
import { fixtureGraph } from "@/api/fixture-graph";
import { resetPushLaneForTests } from "@/session/runtime";
import { useGraphStore } from "@/stores/graph.store";
import { resetOutlineStore } from "@/test-support/outline-store";
import { syncPagePlugins } from "@/test-support/page-plugins";
import { loadExamplePageHalf } from "@/test-support/example-page-half";

const PAGE = "n.root-a";
const CALLOUT_ROW = "n.child-a1";
const PLAIN_ROW = "n.child-a2";
const CALLOUT_TAG = "tag.callout";
const PAGE_ONLY_TAG = "tag.page-only";

const CalloutView = viewKey("test.callout", "Callout", NoParams);
const PageOnlyView = viewKey("test.page-only", "Page only", NoParams);

/** The rows the callout was handed, in the order it drew them. */
const drawn: { readonly id: string | undefined; readonly markdown: string | undefined }[] = [];

function Callout({ host }: ViewProps<unknown>): ReactNode {
  drawn.push({ id: host.row?.id, markdown: host.row?.markdown });
  return (
    <aside data-test-callout={host.row?.id}>
      <span aria-hidden>!</span>
      {host.row?.text}
    </aside>
  );
}

const calloutPlugin = definePlugin({
  name: "test",
  apply: (ctx) =>
    Effect.all(
      [
        ctx.contribute(ViewKeyPoint, { id: "callout", value: { key: CalloutView } }),
        ctx.contribute(ViewKeyPoint, { id: "page-only", value: { key: PageOnlyView } }),
        ctx.contribute(
          ViewPoint,
          provideView(CalloutView, { placements: ["row"], sample: {}, Component: Callout }),
        ),
        ctx.contribute(
          ViewPoint,
          provideView(PageOnlyView, {
            placements: ["page"],
            sample: {},
            Component: () => <section data-test-page-only />,
          }),
        ),
      ],
      { discard: true },
    ),
});

/** `node` tagged `tag`, as the wire carries it. */
function taggedAs(node: WireNode, tag: string): WireNode {
  return { ...node, props: { ...node.props, [SYSTEM_IDS.typeField]: [{ t: "ref", v: tag }] } };
}

/** A tag whose nodes are drawn as `view`. */
function rowTag(id: string, view: string): WireNode {
  return {
    id,
    text: id,
    props: {
      [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.tag }],
      [SYSTEM_IDS.viewRowField]: [{ t: "ref", v: viewOptionId(view) }],
    },
    children: [],
    createdAt: "2026-11-09T00:00:00.000Z",
    updatedAt: "2026-11-09T00:00:00.000Z",
  };
}

/** The fixture graph, with the callout row tagged `#callout` and the plain row a tag drawn only as a page. */
function graph(): WireNode[] {
  const nodes = structuredClone(fixtureGraph.nodes).map((node) =>
    node.id === CALLOUT_ROW
      ? taggedAs(node, CALLOUT_TAG)
      : node.id === PLAIN_ROW
        ? taggedAs(node, PAGE_ONLY_TAG)
        : node,
  );
  return [...nodes, rowTag(CALLOUT_TAG, CalloutView.id), rowTag(PAGE_ONLY_TAG, PageOnlyView.id)];
}

describe("a row drawn as its tag's row view (acceptance)", () => {
  let dom: Window;
  let container: HTMLDivElement;
  let root: Root;

  beforeAll(() => {
    syncPagePlugins([outlineUiPlugin, calloutPlugin]);
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
    useGraphStore.getState().hydrateFromWire(graph(), fixtureGraph.rev, "fixtures");
    resetPushLaneForTests();
    setPostAction(null);
    drawn.length = 0;
    container = dom.document.createElement("div") as unknown as HTMLDivElement;
    dom.document.body.appendChild(container as unknown as never);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const row = (id: string) =>
    container.querySelector<HTMLElement>(`[data-node-row="true"][data-node-id="${id}"]`);

  it("draws a tagged row as its view, around the row's text, and the rest as text", async () => {
    await act(async () => root.render(<OutlineEditor root={PAGE} />));
    const callout = row(CALLOUT_ROW)?.querySelector("[data-test-callout]");
    expect(callout?.getAttribute("data-test-callout")).toBe(CALLOUT_ROW);
    expect(callout?.querySelector(".kb-text")?.textContent).toBe(
      "Load graph into client DataScript",
    );
    expect(drawn.at(-1)).toEqual({
      id: CALLOUT_ROW,
      markdown: "Load graph into client DataScript",
    });
    // A tag whose view this page draws only as a page draws no row.
    expect(row(PLAIN_ROW)?.querySelector("[data-row-view]")).toBeNull();
    expect(row(PLAIN_ROW)?.querySelector(".kb-text")?.textContent).toBe(
      "Render outline with collapse + zoom",
    );
  });

  it("edits as text when its text is pressed, and is drawn as its view again when the edit ends", async () => {
    await act(async () => root.render(<OutlineEditor root={PAGE} />));
    const text = row(CALLOUT_ROW)?.querySelector<HTMLElement>("[data-test-callout] .kb-text");
    if (text === null || text === undefined) throw new Error("the callout drew no text");
    await act(async () => {
      text.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    expect(useOutlineStore.getState().activeNodeId).toBe(CALLOUT_ROW);
    expect(row(CALLOUT_ROW)?.querySelector("[contenteditable]")).not.toBeNull();
    expect(row(CALLOUT_ROW)?.querySelector("[data-test-callout]")).toBeNull();

    await act(async () => useOutlineStore.getState().deactivateNode());
    expect(row(CALLOUT_ROW)?.querySelector("[data-test-callout]")).not.toBeNull();
  });
});

describe("a repository extension's row view (acceptance)", () => {
  let dom: Window;
  let container: HTMLDivElement;
  let root: Root;
  const NOTED = "example.noted";
  let noted: WireNode | undefined;

  beforeAll(async () => {
    const { plugin, declaration } = await loadExamplePageHalf();
    syncPagePlugins([outlineUiPlugin, plugin]);
    // The tag as a store opened with the example holds it: seeded, its row view claimed.
    const core = BUNDLED_DECLARATIONS.filter((family) => family.name === "core");
    noted = foldSeed([...core, declaration]).nodes.find((node) => node.id === NOTED);
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
    if (noted === undefined) throw new Error("the example seeds no #noted tag");
    const nodes = structuredClone(fixtureGraph.nodes).map((node) =>
      node.id === CALLOUT_ROW ? taggedAs(node, NOTED) : node,
    );
    useGraphStore.getState().hydrateFromWire([...nodes, noted], fixtureGraph.rev, "fixtures");
    resetPushLaneForTests();
    setPostAction(null);
    container = dom.document.createElement("div") as unknown as HTMLDivElement;
    dom.document.body.appendChild(container as unknown as never);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("draws a #noted row as the example's note around its text, and edits it as text when pressed", async () => {
    expect(noted).toMatchObject({
      props: { [SYSTEM_IDS.viewRowField]: [{ t: "ref", v: viewOptionId("example.note") }] },
    });
    await act(async () => root.render(<OutlineEditor root={PAGE} />));
    const row = container.querySelector(`[data-node-row="true"][data-node-id="${CALLOUT_ROW}"]`);
    const note = row?.querySelector<HTMLElement>(
      `[data-example="note"][data-row="${CALLOUT_ROW}"]`,
    );
    const text = note?.querySelector<HTMLElement>(".kb-text");
    expect(text?.textContent).toBe("Load graph into client DataScript");
    if (text === null || text === undefined) throw new Error("the note drew no text");
    await act(async () => {
      text.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    expect(useOutlineStore.getState().activeNodeId).toBe(CALLOUT_ROW);
    expect(row?.querySelector("[contenteditable]")).not.toBeNull();
    expect(row?.querySelector('[data-example="note"]')).toBeNull();
  });
});
