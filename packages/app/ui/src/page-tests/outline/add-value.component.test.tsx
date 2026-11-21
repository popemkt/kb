/**
 * Adding a value is the gesture in hand, not a line of its own: Enter at the
 * end of a typed value of a many-valued field opens the next, Enter on that
 * empty one closes it, and a typed value emptied is taken out. Driven through
 * the real stack and store, so what is asserted is what the field holds.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fieldTypeValue, present, SYSTEM_IDS } from "@kb/model";
import type { WireNode } from "@kb/contracts";
import { installDomGlobals, type InstalledDom } from "@kb/ui-test-kit";
import { resetOutlineStore } from "@/test-support/outline-store";
import { fieldContextOf, setCaretSerializedOffset } from "@kb/ui-sdk";
import { useGraphStore } from "@/stores/graph.store";
import { FieldValueStack, outlineNodes, outlineSource } from "@kb/outline-ui";

const ISO = "2026-09-28T00:00:00.000Z";
const wire = (partial: Pick<WireNode, "id" | "text"> & Partial<WireNode>): WireNode => ({
  props: {},
  children: [],
  createdAt: ISO,
  updatedAt: ISO,
  ...partial,
});

const held = () => outlineNodes().get("n.host")?.props["f.note"] ?? [];
const values = (fieldId: string) => outlineNodes().get("n.host")?.props[fieldId] ?? [];

describe("adding a value", () => {
  let dom: InstalledDom;
  let container: HTMLDivElement;
  let root: Root;

  beforeAll(() => {
    dom = installDomGlobals();
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterAll(() => {
    delete (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT;
    dom.restore();
  });

  beforeEach(() => {
    resetOutlineStore();
    useGraphStore.getState().hydrateFromWire(
      [
        wire({ id: "n.host", text: "Host", props: { "f.note": [{ t: "str", v: "one" }] } }),
        wire({
          id: "f.note",
          text: "note",
          props: { [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.field }] },
        }),
      ],
      1,
      "fixtures",
    );
    container = dom.window.document.createElement("div") as unknown as HTMLDivElement;
    dom.window.document.body.appendChild(container as unknown as never);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  async function render() {
    await act(async () => {
      root.render(
        <FieldValueStack
          nodeId="n.host"
          fieldId="f.note"
          fieldType="text"
          values={held()}
          context={fieldContextOf(outlineSource())}
          readOnly={false}
          onFollow={() => undefined}
        />,
      );
    });
  }

  const editor = () =>
    present(container.querySelector<HTMLElement>('[contenteditable="true"]'), "open editor");

  async function key(k: string) {
    await act(async () => {
      editor().dispatchEvent(
        new dom.window.KeyboardEvent("keydown", {
          key: k,
          bubbles: true,
          cancelable: true,
        }) as unknown as Event,
      );
    });
  }

  /** The slot asked its editor to leave; happy-dom's blur does not say so. */
  async function leave(el: HTMLElement) {
    await act(async () => {
      el.dispatchEvent(
        new dom.window.FocusEvent("focusout", { bubbles: true }) as unknown as Event,
      );
    });
  }

  it("has no line of its own: the add is inline on the last value", async () => {
    await render();
    expect(container.querySelectorAll('[data-add-value="true"]').length).toBe(1);
    expect(container.textContent).not.toContain("value");
  });

  it("Enter at the end of a value opens the next; Enter on that empty one closes it", async () => {
    await render();
    await act(async () => {
      present(container.querySelector<HTMLElement>('[data-value-slot="text"]'), "slot").click();
    });
    const first = editor();
    setCaretSerializedOffset(first, 3);
    await key("Enter");
    await leave(first);
    await render();
    // The next value's slot is open, focused, and says what it is for.
    const next = editor();
    expect(next.getAttribute("data-placeholder")).toBe("Enter to add another · Esc to finish");
    expect(held()).toEqual([{ t: "str", v: "one" }]);

    await key("Enter");
    await leave(next);
    await render();
    expect(container.querySelector('[contenteditable="true"]')).toBeNull();
    expect(held()).toEqual([{ t: "str", v: "one" }]);
  });

  it("what is typed into the next slot is the next value", async () => {
    await render();
    await act(async () => {
      present(container.querySelector<HTMLElement>('[data-add-value="true"]'), "+").click();
    });
    const next = editor();
    next.textContent = "two";
    await leave(next);
    await render();
    expect(held()).toEqual([
      { t: "str", v: "one" },
      { t: "str", v: "two" },
    ]);
  });

  it("a typed value emptied is taken out, not kept blank", async () => {
    await render();
    await act(async () => {
      present(container.querySelector<HTMLElement>('[data-value-slot="text"]'), "slot").click();
    });
    const el = editor();
    el.textContent = "";
    await leave(el);
    await render();
    expect(held()).toEqual([]);
  });
});

describe("pasting several lines into a many-valued field", () => {
  let dom: InstalledDom;
  let container: HTMLDivElement;
  let root: Root;

  beforeAll(() => {
    dom = installDomGlobals();
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterAll(() => {
    delete (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT;
    dom.restore();
  });

  beforeEach(() => {
    resetOutlineStore();
    const field = (id: string, type: "text" | "ref" | "number") =>
      wire({
        id,
        text: id,
        props: {
          [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.field }],
          [SYSTEM_IDS.fieldTypeField]: [fieldTypeValue(type)],
        },
      });
    useGraphStore
      .getState()
      .hydrateFromWire(
        [
          wire({ id: "n.host", text: "Host", props: { "f.note": [{ t: "str", v: "one" }] } }),
          field("f.note", "text"),
          field("f.link", "ref"),
          field("f.size", "number"),
          wire({ id: "n.alpha", text: "Alpha" }),
          wire({ id: "n.beta", text: "Beta" }),
        ],
        1,
        "fixtures",
      );
    container = dom.window.document.createElement("div") as unknown as HTMLDivElement;
    dom.window.document.body.appendChild(container as unknown as never);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  async function render(fieldId: string, fieldType: "text" | "ref" | "number") {
    await act(async () => {
      root.render(
        <FieldValueStack
          nodeId="n.host"
          fieldId={fieldId}
          fieldType={fieldType}
          values={values(fieldId)}
          context={fieldContextOf(outlineSource())}
          readOnly={false}
          onFollow={() => undefined}
        />,
      );
    });
  }

  /** A paste of `text` at `el`, as the browser hands it to the page. */
  async function paste(el: Element, text: string) {
    await act(async () => {
      const event = new dom.window.Event("paste", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "clipboardData", {
        value: { getData: (type: string) => (type === "text/plain" ? text : "") },
      });
      el.dispatchEvent(event as unknown as Event);
    });
  }

  async function open(fieldId: string) {
    await act(async () => {
      present(
        container.querySelector<HTMLElement>(`[data-field-values="${fieldId}"] [data-value-slot]`),
        "slot",
      ).click();
    });
  }

  it("adds one typed value per line, after the field's values, as one undo step", async () => {
    await render("f.note", "text");
    await open("f.note");
    const undo = useGraphStore.getState().undoStack.length;
    await paste(
      present(container.querySelector('[contenteditable="true"]'), "editor"),
      "two\n\n  three \n",
    );
    await vi.waitFor(() =>
      expect(values("f.note")).toEqual([
        { t: "str", v: "one" },
        { t: "str", v: "two" },
        { t: "str", v: "three" },
      ]),
    );
    expect(useGraphStore.getState().undoStack.length).toBe(undo + 1);
  });

  it("names a picked field's targets by line", async () => {
    await render("f.link", "ref");
    await open("f.link");
    await paste(present(container.querySelector("input"), "picker input"), "Alpha\nBeta");
    await vi.waitFor(() =>
      expect(values("f.link")).toEqual([
        { t: "ref", v: "n.alpha" },
        { t: "ref", v: "n.beta" },
      ]),
    );
  });

  it("leaves a paste with a line the field cannot read to the editor", async () => {
    await render("f.size", "number");
    await open("f.size");
    const editor = present(container.querySelector('[contenteditable="true"]'), "editor");
    await paste(editor, "3\nlots");
    expect(values("f.size")).toEqual([]);
  });
});
