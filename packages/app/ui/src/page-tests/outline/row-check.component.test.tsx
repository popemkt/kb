/**
 * A tag's box on its row (DESIGN-UI.md → A tag's box): drawn from the
 * field its tag ties it to, named by that field, and pressing it writes the
 * field and nothing else, leaving the row as it was.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Window } from "happy-dom";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { fieldTypeValue, present, SYSTEM_IDS } from "@kb/model";
import type { WireNode } from "@kb/contracts";
import { fixtureGraph } from "@/api/fixture-graph";
import { browserHost, outlineInstanceKey, syncUiPlugins } from "@kb/ui-sdk";
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

const ref = (v: string) => ({ t: "ref" as const, v });

/** #task's box is status = Done; a plain row has none. */
const WIRES: WireNode[] = [
  wire({
    id: "f.status",
    text: "status",
    props: {
      [SYSTEM_IDS.typeField]: [ref(SYSTEM_IDS.field)],
      [SYSTEM_IDS.fieldTypeField]: [fieldTypeValue("ref")],
      [SYSTEM_IDS.cardinalityField]: [ref(SYSTEM_IDS.cardinalityOne)],
    },
    children: ["opt.open", "opt.done"],
  }),
  wire({ id: "opt.open", text: "Open" }),
  wire({ id: "opt.done", text: "Done" }),
  wire({
    id: "t.task",
    text: "task",
    props: {
      [SYSTEM_IDS.typeField]: [ref(SYSTEM_IDS.tag)],
      [SYSTEM_IDS.tagCheckField]: [ref("f.status")],
      [SYSTEM_IDS.tagCheckedValueField]: [ref("opt.done")],
    },
  }),
  wire({
    id: "n.ship",
    text: "ship",
    props: { [SYSTEM_IDS.typeField]: [ref("t.task")], "f.status": [ref("opt.open")] },
  }),
];

function click(el: Element) {
  const Ctor = (globalThis as unknown as { MouseEvent: typeof MouseEvent }).MouseEvent;
  el.dispatchEvent(new Ctor("mousedown", { bubbles: true, cancelable: true }));
  el.dispatchEvent(new Ctor("click", { bubbles: true, cancelable: true }));
}

/** Let the write's local apply land. */
const settle = () => act(async () => await new Promise((resolve) => setTimeout(resolve, 0)));

describe("a tag's box", () => {
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

  const boxOf = (key: string) =>
    present(
      container.querySelector<HTMLElement>(`[data-instance-key="${key}"] [role="checkbox"]`),
      "the row's box",
    );

  it("is a checkbox named by its field, checked by the field's value", async () => {
    const key = await render("n.ship");
    const box = boxOf(key);
    expect(box.getAttribute("aria-label")).toBe("status");
    expect(box.getAttribute("aria-checked")).toBe("false");
    // A row with no check draws no box.
    const plain = await render("n.root-c");
    expect(container.querySelector(`[data-instance-key="${plain}"] [role="checkbox"]`)).toBeNull();
  });

  it("pressing it writes the field, and pressing again unsets the checked value", async () => {
    const key = await render("n.ship");
    await act(async () => click(boxOf(key)));
    await settle();
    expect(outlineNodes().get("n.ship")?.props["f.status"]).toEqual([ref("opt.done")]);
    await render("n.ship");
    expect(boxOf(key).getAttribute("aria-checked")).toBe("true");
    await act(async () => click(boxOf(key)));
    await settle();
    expect(outlineNodes().get("n.ship")?.props["f.status"] ?? []).toEqual([]);
  });

  it("is one undo step", async () => {
    const key = await render("n.ship");
    await act(async () => click(boxOf(key)));
    await settle();
    expect(outlineNodes().get("n.ship")?.props["f.status"]).toEqual([ref("opt.done")]);
    await act(async () => {
      await browserHost().writes.undo();
    });
    await settle();
    expect(outlineNodes().get("n.ship")?.props["f.status"]).toEqual([ref("opt.open")]);
  });

  it("leaves the row as it was: no edit starts, no selection moves, the text stays", async () => {
    const key = await render("n.ship");
    await act(async () => click(boxOf(key)));
    await settle();
    const s = useOutlineStore.getState();
    expect(s.activeNodeId).toBeNull();
    expect(s.selectedNodeId).toBeNull();
    expect(outlineNodes().get("n.ship")?.text).toBe("ship");
  });

  it("Escape on the focused box goes back to its row, selected", async () => {
    const key = await render("n.ship");
    const box = boxOf(key);
    box.focus();
    const Ctor = (globalThis as unknown as { KeyboardEvent: typeof KeyboardEvent }).KeyboardEvent;
    const escape = new Ctor("keydown", { key: "Escape", bubbles: true, cancelable: true });
    await act(async () => box.dispatchEvent(escape));
    expect(escape.defaultPrevented).toBe(true);
    const s = useOutlineStore.getState();
    expect(s.selectedNodeId).toBe("n.ship");
    expect(s.selectedInstanceKey).toBe(key);
    expect(dom.document.activeElement.getAttribute("role")).toBe("treeitem");
    expect(outlineNodes().get("n.ship")?.props["f.status"]).toEqual([ref("opt.open")]);
  });

  it("a value set on the field checks the box", async () => {
    useGraphStore
      .getState()
      .hydrateFromWire(
        [
          ...fixtureGraph.nodes,
          ...WIRES.map((w) =>
            w.id === "n.ship" ? { ...w, props: { ...w.props, "f.status": [ref("opt.done")] } } : w,
          ),
        ],
        fixtureGraph.rev,
        "fixtures",
      );
    const key = await render("n.ship");
    expect(boxOf(key).getAttribute("aria-checked")).toBe("true");
  });
});
