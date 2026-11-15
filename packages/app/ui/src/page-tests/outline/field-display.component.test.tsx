/**
 * Field display in the rendered outline (DESIGN-UI.md → Field values →
 * hidden fields chips): a field shown when filled is a chip while it is
 * empty, a hidden one always, both in one line after the rows; tucked
 * fields wait behind its "…"; a chip opens its field as a row, and Escape
 * on the empty value closes it again. A pinned field leads the rows.
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
const show = (option: string) => ({ [SYSTEM_IDS.showField]: [{ t: "ref" as const, v: option }] });
const FILLED = show(SYSTEM_IDS.showFilled);

/**
 * A #project templating status, a pinned priority, a field shown when
 * filled, a hidden one and two tucked ones.
 */
function graph(member: Record<string, PropValue[]> = {}): WireNode[] {
  return [
    present(
      bundledSeed(ISO).find((n) => n.id === SYSTEM_IDS.typeField),
      SYSTEM_IDS.typeField,
    ),
    field("f.status"),
    field("f.priority", { [SYSTEM_IDS.pinnedField]: [{ t: "bool", v: true }] }),
    field("f.source", FILLED),
    field("f.archived", show(SYSTEM_IDS.showHidden)),
    field("f.budget", show(SYSTEM_IDS.showTucked)),
    field("f.venue", show(SYSTEM_IDS.showTucked)),
    wire({
      id: "t.project",
      text: "project",
      props: {
        [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.tag }],
        [SYSTEM_IDS.fieldsField]: [
          "f.status",
          "f.source",
          "f.archived",
          "f.budget",
          "f.venue",
          "f.priority",
        ].map((v) => ({ t: "ref" as const, v })),
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

  async function render(
    member: Record<string, PropValue[]> = {},
    nodes: (member: Record<string, PropValue[]>) => WireNode[] = graph,
  ) {
    resetOutlineStore();
    useGraphStore.getState().hydrateFromWire(nodes(member), 1, "fixtures");
    useDebugFieldsStore.setState({ ids: new Set() });
    await act(async () => {
      root.render(<FieldsSection nodeId="n.p" depth={0} instanceKey="tree/n.p" />);
    });
  }

  const drawn = () =>
    [...container.querySelectorAll("[data-field-values]")].map((el) =>
      el.getAttribute("data-field-values"),
    );
  const line = () => container.querySelector<HTMLElement>("[data-hidden-fields]");
  const chip = (id: string) =>
    present(container.querySelector<HTMLButtonElement>(`[data-field-chip="${id}"]`), id);
  const chipNames = () =>
    [...container.querySelectorAll("[data-field-chip]")].map((el) => el.textContent);
  const more = () => container.querySelector<HTMLButtonElement>("[data-tucked-fields]");
  const focused = () => dom.document.activeElement as unknown as Element | null;
  const key = async (target: Element, k: string) => {
    await act(async () => {
      target.dispatchEvent(
        new dom.KeyboardEvent("keydown", { key: k, bubbles: true }) as unknown as Event,
      );
    });
  };

  it("draws the pinned field first, then one line of chips naming the hidden fields", async () => {
    await render();
    expect(drawn()).toEqual(["f.priority", "f.status"]);
    expect(chipNames()).toEqual(["source", "archived"]);
    expect(line()?.getAttribute("role")).toBe("group");
    expect(line()?.getAttribute("aria-label")).toBe("Hidden fields: source, archived");
    expect(line()?.hasAttribute("data-value-slot")).toBe(true);
  });

  it("keeps a hidden field a chip when filled, and a field shown when filled a row", async () => {
    await render({
      "f.source": [{ t: "str", v: "the brief" }],
      "f.archived": [{ t: "str", v: "2026" }],
    });
    // A value the node holds comes before the slots its tag templates.
    expect(drawn()).toEqual(["f.priority", "f.source", "f.status"]);
    expect(chipNames()).toEqual(["archived"]);
  });

  it("groups the tucked fields behind one trailing …, which expands them in place", async () => {
    await render();
    const dots = present(more(), "…");
    expect(dots.getAttribute("aria-label")).toBe("2 more fields");
    expect(chipNames()).toEqual(["source", "archived"]);
    await act(async () => dots.click());
    expect(more()).toBeNull();
    expect(chipNames()).toEqual(["source", "archived", "budget", "venue"]);
    expect(focused()).toBe(chip("f.budget"));
    expect(line()?.getAttribute("aria-label")).toBe(
      "Hidden fields: source, archived, budget, venue",
    );
  });

  it("draws only … when every hidden field is tucked", async () => {
    const tuckedOnly = (member: Record<string, PropValue[]>) =>
      graph(member).filter((n) => n.id !== "f.source" && n.id !== "f.archived");
    await render({}, tuckedOnly);
    expect(chipNames()).toEqual([]);
    expect(more()?.getAttribute("aria-label")).toBe("2 more fields");
    expect(line()?.getAttribute("aria-label")).toBe("Hidden fields");
  });

  it("draws a field hidden with the old checkbox as a chip, on a store never migrated", async () => {
    // The shape a store written before show holds: the checkbox, and no show.
    const unmigrated = (member: Record<string, PropValue[]>) =>
      graph(member).map((n) =>
        n.id === "f.archived"
          ? field("f.archived", { [SYSTEM_IDS.hiddenField]: [{ t: "bool", v: true }] })
          : n,
      );
    await render({}, unmigrated);
    expect(drawn()).toEqual(["f.priority", "f.status"]);
    expect(chipNames()).toEqual(["source", "archived"]);
  });

  it("opens a chip's field as a row with the keyboard on its value, without writing show", async () => {
    await render();
    await act(async () => chip("f.archived").click());
    expect(drawn()).toEqual(["f.priority", "f.status", "f.archived"]);
    expect(chipNames()).toEqual(["source"]);
    const slot = container.querySelector('[data-field-values="f.archived"] [data-value-slot]');
    expect(focused()).toBe(slot);
    // Screen state only: the row drawn afresh places the field by its show again.
    act(() => root.unmount());
    root = createRoot(container);
    await render();
    expect(chipNames()).toEqual(["source", "archived"]);
  });

  it("closes an opened field back into its chip on Escape while its value is empty", async () => {
    await render();
    await act(async () => chip("f.source").click());
    await key(present(focused(), "the value"), "Escape");
    expect(drawn()).toEqual(["f.priority", "f.status"]);
    expect(chipNames()).toEqual(["source", "archived"]);
    expect(focused()).toBe(chip("f.source"));
  });

  it("walks its chips with ←/→, … last, stopping at either end", async () => {
    await render();
    chip("f.source").focus();
    await key(chip("f.source"), "ArrowLeft");
    expect(focused()).toBe(chip("f.source"));
    await key(chip("f.source"), "ArrowRight");
    expect(focused()).toBe(chip("f.archived"));
    await key(chip("f.archived"), "ArrowRight");
    expect(focused()).toBe(more());
    await key(present(more(), "…"), "ArrowRight");
    expect(focused()).toBe(more());
    // One tab stop: the chip the keyboard stands on.
    expect(chip("f.source").tabIndex).toBe(-1);
    expect(more()?.tabIndex).toBe(0);
  });

  it("is one stop in the values' keyboard path: ↑ from the line lands on the last value", async () => {
    await render();
    chip("f.archived").focus();
    await key(chip("f.archived"), "ArrowUp");
    const status = container.querySelector('[data-field-values="f.status"] [data-value-slot]');
    expect(focused()).toBe(status);
  });
});
