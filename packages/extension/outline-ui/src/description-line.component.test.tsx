/**
 * A node's description, edited where it is drawn (DESIGN-UI.md → Outline
 * editor, "A node's description"): it shows trimmed, emptying it takes out
 * the value as it is stored, and where the keyboard goes after an edit is
 * the value slot's, by the key that ended it. Enter and Escape hand it back
 * to the row, Tab goes on to the row's first field value, a line break
 * ends nothing, and an edit that ends because focus went elsewhere leaves
 * focus there.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { present, SYSTEM_IDS } from "@kb/model";
import {
  fieldContextOf,
  fieldsSectionProps,
  pageTitleInstanceKey,
  schemaOfGraph,
  syncUiPlugins,
  type NodeMap,
  type OutlineNode,
  type PropValue,
} from "@kb/ui-sdk";
import {
  installDomGlobals,
  testBrowserHost,
  testHostPlugin,
  type InstalledDom,
  type TestBrowserHost,
} from "@kb/ui-test-kit";
import { DescriptionLine } from "./description-line";
import { describe as askForDescription, useDescribing } from "./description-state";
import { outlineValueKindsPlugin } from "./slot-kind";
import { ValueSlot } from "./value-slot";

const NODE = "n.described";
const AT = pageTitleInstanceKey(NODE);
const NO_NODES: NodeMap = new Map();
const FIELD_CONTEXT = fieldContextOf({
  schema: schemaOfGraph(NO_NODES),
  nodes: NO_NODES,
  queries: null,
});

function node(description?: string): OutlineNode {
  return {
    id: NODE,
    text: "Described",
    props:
      description === undefined
        ? {}
        : { [SYSTEM_IDS.descriptionField]: [{ t: "str", v: description }] },
    children: [],
  } as unknown as OutlineNode;
}

describe("a node's description line", () => {
  let dom: InstalledDom;
  let host: TestBrowserHost;
  let removed: PropValue[];
  let container: HTMLDivElement;
  let root: Root;

  beforeAll(() => {
    dom = installDomGlobals();
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterAll(() => {
    syncUiPlugins([]);
    delete (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT;
    dom.restore();
  });

  beforeEach(() => {
    removed = [];
    const base = testBrowserHost();
    host = testBrowserHost({
      writes: {
        ...base.writes,
        removeProp: (_nodeId, _fieldId, value) => {
          if (value !== undefined) removed.push(value);
          return Promise.resolve();
        },
      },
    });
    syncUiPlugins([testHostPlugin(host), outlineValueKindsPlugin]);
    useDescribing.setState({ at: null, gesture: 0 });
    container = dom.window.document.createElement("div") as unknown as HTMLDivElement;
    dom.window.document.body.appendChild(container as unknown as never);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  /**
   * The line in its row's block: the row's tree item ahead of it, the row's
   * fields section after it with one field value, and a control past the row.
   */
  async function draw(description?: string) {
    host.setNodes([node(description)]);
    await act(async () => {
      root.render(
        createElement(
          "div",
          null,
          createElement(
            "div",
            { "data-node-block": "true" },
            createElement("div", { role: "treeitem", tabIndex: -1, "data-row": "true" }),
            createElement(DescriptionLine, { rowId: NODE, nodeId: NODE, instanceKey: AT }),
            createElement(
              "div",
              fieldsSectionProps(NODE, AT),
              createElement(ValueSlot, {
                value: { t: "str", v: "todo" },
                fieldType: "text",
                fieldId: "f.status",
                context: FIELD_CONTEXT,
                onCommit: () => undefined,
                onFollow: () => undefined,
              }),
            ),
          ),
          createElement("button", { type: "button", "data-next": "true" }, "Next"),
        ),
      );
    });
  }

  const line = () => container.querySelector<HTMLElement>("[data-description]");
  const editable = () =>
    present(line()?.querySelector<HTMLElement>('[data-editable-text="true"]'), "editable");
  const row = () => present(container.querySelector<HTMLElement>("[data-row]"), "row");
  const next = () => present(container.querySelector<HTMLElement>("[data-next]"), "next control");
  const fieldValue = () =>
    present(
      container.querySelector<HTMLElement>("[data-fields-of] [data-value-slot]"),
      "field value",
    );
  const focused = () => dom.window.document.activeElement;

  async function press(key: string, init: { shiftKey?: boolean } = {}) {
    await act(async () => {
      editable().dispatchEvent(
        new dom.window.KeyboardEvent("keydown", {
          key,
          ...init,
          bubbles: true,
          cancelable: true,
        }) as unknown as Event,
      );
    });
  }

  /**
   * Focus moves to `to` and the editor's blur lands, when the editor is
   * still open: focus moved by hand is not a blur happy-dom dispatches on a
   * contenteditable, so it is completed here, as the slot's own tests do.
   */
  async function focusOut(to: HTMLElement | null = null) {
    const from = line()?.querySelector<HTMLElement>('[data-editable-text="true"]');
    await act(async () => {
      to?.focus();
      from?.dispatchEvent(
        new dom.window.FocusEvent("focusout", {
          bubbles: true,
          relatedTarget: to as never,
        }) as unknown as Event,
      );
    });
  }

  /** A gesture opens the empty description, editing. */
  async function openEmpty() {
    await draw();
    await act(async () => askForDescription(NODE));
    expect(editable().getAttribute("contenteditable")).toBe("true");
  }

  it("shows the description trimmed, as every other surface does", async () => {
    await draw("\n\n  Padded with space  ");
    expect(present(line(), "line").textContent).toBe("Padded with space");
  });

  it("takes out the description as it is stored when it is emptied", async () => {
    await draw("  Padded with space  ");
    await act(async () => {
      present(line()?.querySelector<HTMLElement>("[data-value-slot]"), "slot").click();
    });
    editable().textContent = "";
    await press("Enter");
    await focusOut();
    expect(removed).toEqual([{ t: "str", v: "  Padded with space  " }]);
  });

  it("leaves focus where it went when an empty description loses it", async () => {
    await openEmpty();
    await focusOut(next());
    expect(focused()).toBe(next());
    expect(line()).toBeNull();
  });

  it("hands the keyboard back to the row when Escape leaves an empty description", async () => {
    await openEmpty();
    await press("Escape");
    await focusOut();
    expect(focused()).toBe(row());
    expect(line()).toBeNull();
  });

  it("hands the keyboard back to the row when Enter leaves it empty", async () => {
    await openEmpty();
    await press("Enter");
    await focusOut();
    expect(focused()).toBe(row());
  });

  it("goes on to the row's first field value when Tab leaves it empty", async () => {
    await openEmpty();
    await press("Tab");
    await focusOut();
    expect(focused()).toBe(fieldValue());
    expect(line()).toBeNull();
  });

  it("ends nothing on Shift+Enter: a later blur keeps its destination", async () => {
    await openEmpty();
    await press("Enter", { shiftKey: true });
    expect(editable().getAttribute("contenteditable")).toBe("true");
    await focusOut(next());
    // Nothing deferred may pull it back afterwards.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
    expect(focused()).toBe(next());
  });
});
