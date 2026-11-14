/**
 * Field display in the rendered outline (DESIGN-UI.md → Field values →
 * hidden fields fold): a field shown when filled folds while it is empty,
 * into one "N hidden fields" row that a click or the keyboard opens, and a
 * pinned field leads the rows.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Window } from "happy-dom";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { WireNode } from "@kb/contracts";
import { syncUiPlugins } from "@kb/ui-sdk";
import { bundledSeed } from "@kb/bundled";
import { present, SYSTEM_IDS, type PropValue } from "@kb/model";
import { useDebugFieldsStore } from "@/stores/debug-fields.store";
import { useGraphStore } from "@/stores/graph.store";
import { resetOutlineStore } from "@/test-support/outline-store";
import { syncPagePlugins } from "@/test-support/page-plugins";
import { outlineUiPlugin } from "@/test-support/outline-plugin";
import { FieldsSection } from "@kb/outline-ui";

const ISO = "2026-11-14T05:00:00.000Z";

function wire(partial: Pick<WireNode, "id" | "text"> & Partial<WireNode>): WireNode {
  return { props: {}, children: [], createdAt: ISO, updatedAt: ISO, ...partial };
}

const field = (id: string, props: Record<string, PropValue[]> = {}) =>
  wire({
    id,
    text: id.slice(2),
    props: { [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.field }], ...props },
  });
const FILLED = { [SYSTEM_IDS.showField]: [{ t: "ref" as const, v: SYSTEM_IDS.showFilled }] };

/** A #project templating status, a pinned priority and two fields shown when filled. */
function graph(member: Record<string, PropValue[]> = {}): WireNode[] {
  return [
    present(
      bundledSeed(ISO).find((n) => n.id === SYSTEM_IDS.typeField),
      SYSTEM_IDS.typeField,
    ),
    field("f.status"),
    field("f.priority", { [SYSTEM_IDS.pinnedField]: [{ t: "bool", v: true }] }),
    field("f.source", FILLED),
    field("f.archived", FILLED),
    wire({
      id: "t.project",
      text: "project",
      props: {
        [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.tag }],
        [SYSTEM_IDS.fieldsField]: ["f.status", "f.source", "f.archived", "f.priority"].map((v) => ({
          t: "ref" as const,
          v,
        })),
      },
    }),
    wire({
      id: "n.p",
      text: "Plan the workshop",
      props: { [SYSTEM_IDS.typeField]: [{ t: "ref", v: "t.project" }], ...member },
    }),
  ];
}

describe("field display: show and pinned", () => {
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
    syncPagePlugins([outlineUiPlugin]);
  });

  afterAll(() => syncUiPlugins([]));

  beforeEach(() => {
    container = dom.document.createElement("div") as unknown as HTMLDivElement;
    dom.document.body.appendChild(container as unknown as never);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  async function render(member: Record<string, PropValue[]> = {}) {
    resetOutlineStore();
    useGraphStore.getState().hydrateFromWire(graph(member), 1, "fixtures");
    useDebugFieldsStore.setState({ ids: new Set() });
    await act(async () => {
      root.render(<FieldsSection nodeId="n.p" depth={0} instanceKey="tree/n.p" />);
    });
  }

  const drawn = () =>
    [...container.querySelectorAll("[data-field-values]")].map((el) =>
      el.getAttribute("data-field-values"),
    );
  const fold = () => container.querySelector<HTMLButtonElement>("[data-hidden-fields-fold]");

  it("draws the pinned field first and folds the empty fields shown when filled", async () => {
    await render();
    expect(drawn()).toEqual(["f.priority", "f.status"]);
    expect(fold()?.textContent).toContain("2 hidden fields");
    expect(fold()?.getAttribute("aria-expanded")).toBe("false");
  });

  it("opens the fold on a click, drawing the folded fields as slots to fill, and closes it", async () => {
    await render();
    await act(async () => fold()?.click());
    expect(fold()?.getAttribute("aria-expanded")).toBe("true");
    expect(drawn()).toEqual(["f.priority", "f.status", "f.source", "f.archived"]);
    await act(async () => fold()?.click());
    expect(drawn()).toEqual(["f.priority", "f.status"]);
  });

  it("draws a field shown when filled as a row once it holds a value", async () => {
    await render({ "f.source": [{ t: "str", v: "the brief" }] });
    // A value the node holds comes before the slots its tag templates.
    expect(drawn()).toEqual(["f.priority", "f.source", "f.status"]);
    expect(fold()?.textContent).toContain("1 hidden field");
  });

  it("is in the values' keyboard path: a slot, focusable, that Escape leaves for the row", async () => {
    await render();
    const button = present(fold(), "fold");
    expect(button.hasAttribute("data-value-slot")).toBe(true);
    button.focus();
    expect(dom.document.activeElement).toBe(button as unknown as never);
  });
});
