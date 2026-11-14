/**
 * Titles from fields on the page (DESIGN-UI.md → Titles from fields): a node
 * whose tag builds a title from its fields is drawn by it while no one
 * edits its row, a ref value and the node picker name it by it, and editing
 * the row edits the stored text, the caret at its end.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Window } from "happy-dom";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { present, SYSTEM_IDS } from "@kb/model";
import type { WireNode } from "@kb/contracts";
import { fixtureGraph } from "@/api/fixture-graph";
import {
  formatPropValue,
  getCaretSerializedOffset,
  nodeCandidates,
  outlineInstanceKey,
  schemaOf,
  syncUiPlugins,
} from "@kb/ui-sdk";
import { useGraphStore } from "@/stores/graph.store";
import { resetOutlineStore } from "@/test-support/outline-store";
import { syncPagePlugins } from "@/test-support/page-plugins";
import { NodeBlock, outlineNodes, useOutlineStore } from "@kb/outline-ui";
import { outlineUiPlugin } from "@/test-support/outline-plugin";

beforeAll(() => syncPagePlugins([outlineUiPlugin]));
afterAll(() => syncUiPlugins([]));

const ISO = "2026-11-14T05:00:00.000Z";

function wire(partial: Pick<WireNode, "id" | "text"> & Partial<WireNode>): WireNode {
  return { props: {}, children: [], createdAt: ISO, updatedAt: ISO, ...partial };
}

/** A #task titled "<text> for <who>", one task with a who and one without. */
const WIRES: WireNode[] = [
  wire({
    id: "f.who",
    text: "who",
    props: { [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.field }] },
  }),
  wire({
    id: "t.task",
    text: "task",
    props: {
      [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.tag }],
      [SYSTEM_IDS.fieldsField]: [{ t: "ref", v: "f.who" }],
      [SYSTEM_IDS.tagTitleField]: [{ t: "str", v: "[[sys.f.node.text]] for [[f.who]]" }],
    },
  }),
  wire({ id: "n.ann", text: "Ann" }),
  wire({
    id: "n.ship",
    text: "ship",
    props: {
      [SYSTEM_IDS.typeField]: [{ t: "ref", v: "t.task" }],
      "f.who": [{ t: "ref", v: "n.ann" }],
    },
  }),
  wire({
    id: "n.draft",
    text: "draft",
    props: { [SYSTEM_IDS.typeField]: [{ t: "ref", v: "t.task" }] },
  }),
];

function click(el: Element) {
  const Ctor = (globalThis as unknown as { MouseEvent: typeof MouseEvent }).MouseEvent;
  el.dispatchEvent(new Ctor("click", { bubbles: true, cancelable: true }));
}

describe("titles from fields", () => {
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
    useGraphStore
      .getState()
      .hydrateFromWire([...fixtureGraph.nodes, ...WIRES], fixtureGraph.rev, "fixtures");
    container = dom.document.createElement("div") as unknown as HTMLDivElement;
    dom.document.body.appendChild(container as unknown as never);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  async function render(nodeId: string) {
    const key = outlineInstanceKey(nodeId, outlineNodes());
    await act(async () => {
      root.render(<NodeBlock nodeId={nodeId} instanceKey={key} depth={0} />);
    });
    return key;
  }

  const textOf = (key: string) =>
    present(
      container.querySelector(`[data-instance-key="${key}"] .kb-text-row`),
      `the text of ${key}`,
    );

  it("draws the title at rest, and the text until every field it names is filled", async () => {
    const key = await render("n.ship");
    expect(textOf(key).textContent).toBe("ship for Ann");
    const draft = await render("n.draft");
    expect(textOf(draft).textContent).toBe("draft");
  });

  it("pressing the title edits the stored text, the caret at its end", async () => {
    const key = await render("n.ship");
    await act(async () => click(textOf(key)));
    await render("n.ship");
    const s = useOutlineStore.getState();
    expect(s.activeNodeId).toBe("n.ship");
    const editor = present(
      container.querySelector<HTMLElement>(`[data-instance-key="${key}"] [contenteditable="true"]`),
      "editor",
    );
    expect(editor.textContent).toBe("ship");
    expect(getCaretSerializedOffset(editor)).toBe("ship".length);
    // Never written: the stored text stays the person's.
    expect(outlineNodes().get("n.ship")?.text).toBe("ship");
  });

  it("a ref value and the node picker name the node by its title", () => {
    const offered = nodeCandidates(outlineNodes()).find((c) => c.id === "n.ship");
    expect(offered?.label).toBe("ship for Ann");
    const schema = schemaOf(useGraphStore.getState());
    expect(formatPropValue({ t: "ref", v: "n.ship" }, schema)).toBe("ship for Ann");
  });
});
