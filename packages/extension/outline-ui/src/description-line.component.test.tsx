/**
 * A node's description, edited where it is drawn (DESIGN-UI.md → Outline
 * editor, "A node's description"): emptying it takes out the value as it is
 * stored, and the keyboard goes back to the row only when a key asks for
 * it, so an edit that ends because focus went elsewhere leaves focus there.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { present, SYSTEM_IDS } from "@kb/model";
import { pageTitleInstanceKey, syncUiPlugins, type OutlineNode, type PropValue } from "@kb/ui-sdk";
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

const NODE = "n.described";
const AT = pageTitleInstanceKey(NODE);

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

/** The microtask and the frame the line's leaving waits for. */
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 5));
  });
}

describe("a node's description line", () => {
  let dom: InstalledDom;
  let host: TestBrowserHost;
  let removed: PropValue[];
  let container: HTMLDivElement;
  let root: Root;

  beforeAll(() => {
    dom = installDomGlobals();
    // The line reads where focus went a frame after a blur, as a browser
    // paints it; the kit's inline frame would read it mid-move. `restore`
    // puts the global back.
    (globalThis as Record<string, unknown>).requestAnimationFrame = (cb: (t: number) => void) =>
      setTimeout(() => cb(0), 0);
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

  /** The line in its row's block, the row's tree item ahead of it, and a control after. */
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
          ),
          createElement("button", { type: "button", "data-next": "true" }, "Next"),
        ),
      );
    });
  }

  const editable = () =>
    present(container.querySelector<HTMLElement>('[data-editable-text="true"]'), "editable");
  const row = () => present(container.querySelector<HTMLElement>("[data-row]"), "row");
  const next = () => present(container.querySelector<HTMLElement>("[data-next]"), "next control");

  async function press(key: string) {
    await act(async () => {
      editable().dispatchEvent(
        new dom.window.KeyboardEvent("keydown", {
          key,
          bubbles: true,
          cancelable: true,
        }) as unknown as Event,
      );
    });
  }

  /** The editor loses focus; happy-dom's blur() does not dispatch focusout on a contenteditable. */
  async function focusOut(to: HTMLElement | null) {
    await act(async () => {
      to?.focus();
      editable().dispatchEvent(
        new dom.window.FocusEvent("focusout", {
          bubbles: true,
          relatedTarget: to as never,
        }) as unknown as Event,
      );
    });
    await settle();
  }

  /** A gesture opens the empty description, editing. */
  async function openEmpty() {
    await draw();
    await act(async () => askForDescription(NODE));
    expect(editable().getAttribute("contenteditable")).toBe("true");
  }

  it("takes out the description as it is stored when it is emptied", async () => {
    await draw("  Padded with space  ");
    await act(async () => {
      present(container.querySelector<HTMLElement>("[data-value-slot]"), "slot").click();
    });
    editable().textContent = "";
    await press("Enter");
    await focusOut(null);
    expect(removed).toEqual([{ t: "str", v: "  Padded with space  " }]);
  });

  it("leaves focus where it went when an empty description loses it", async () => {
    await openEmpty();
    await focusOut(next());
    expect(dom.window.document.activeElement).toBe(next());
  });

  it("hands the keyboard back to the row when Escape leaves an empty description", async () => {
    await openEmpty();
    await press("Escape");
    await settle();
    expect(dom.window.document.activeElement).toBe(row());
  });
});
