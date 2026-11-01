/**
 * A row's tag opening, drawn (DESIGN-UI.md → Opening a node → a tag's
 * opening): whether a display option is on for a node — its own toggle,
 * else its view's family's setting, and never where the opening does not
 * offer it; the preview, the opening's view at placement `preview` in a
 * box of its family's height, drawn when it is turned on after its row
 * mounted too; and "Open in …" as a segment of the tag's chip, which costs
 * the row nothing.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Effect } from "effect";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DISPLAY_DEFAULTS,
  DISPLAY_OPTIONS,
  type DisplayOption,
  type DisplaySettings,
} from "@kb/model";
import { OUTLINE_IDS } from "@kb/outline";
import { definePlugin } from "@kb/plugin";
import { NoParams, viewKey } from "@kb/views";
import {
  provideView,
  syncUiPlugins,
  TagChipGroup,
  ViewPoint,
  type OutlineNode,
  type TagOpening,
} from "@kb/ui-sdk";
import { installDomGlobals, type InstalledDom } from "@kb/ui-test-kit";
import { RowPreview } from "./row-preview";
import { displayShownOf, type RowOpening } from "./row-opening";

const PreviewedView = viewKey("test.previewed", "Board", NoParams, undefined, { preview: true });

const previewPlugin = definePlugin({
  name: "test",
  apply: (ctx) =>
    Effect.asVoid(
      ctx.contribute(
        ViewPoint,
        provideView(PreviewedView, {
          placements: ["page"],
          sample: {},
          Component: () => createElement("span", { "data-test-preview": true }),
        }),
      ),
    ),
});

/** The board node, its own preview toggle `own` (absent, it says nothing). */
function node(own?: boolean): OutlineNode {
  return {
    id: "n.board",
    text: "Board",
    props:
      own === undefined ? {} : { [OUTLINE_IDS.displayFields.preview]: [{ t: "bool", v: own }] },
    children: [],
  } as unknown as OutlineNode;
}

function tagOpening(
  settings: Partial<DisplaySettings>,
  options: readonly DisplayOption[] = DISPLAY_OPTIONS,
): TagOpening {
  return {
    tag: "sys.tag.board",
    key: PreviewedView,
    picker: undefined,
    options,
    settings: { ...DISPLAY_DEFAULTS, ...settings },
  };
}

/** The board's row opening, as `useRowOpening` reads it for `node(own)`. */
function opening(own?: boolean, settings: Partial<DisplaySettings> = {}): RowOpening {
  const base = tagOpening(settings);
  return {
    ...base,
    label: PreviewedView.label,
    icon: null,
    shown: {
      preview: displayShownOf(node(own), base, "preview"),
      properties: displayShownOf(node(own), base, "properties"),
    },
    revealed: new Set(),
  };
}

describe("whether a display option is on for a node", () => {
  it("is the node's own toggle, else its family's setting", () => {
    expect(displayShownOf(node(), tagOpening({}), "preview")).toBe(false);
    expect(displayShownOf(node(), tagOpening({ preview: "always" }), "preview")).toBe(true);
    expect(displayShownOf(node(false), tagOpening({ preview: "always" }), "preview")).toBe(false);
    expect(displayShownOf(node(true), tagOpening({}), "preview")).toBe(true);
  });

  it("is never on where the opening does not offer it", () => {
    expect(displayShownOf(node(true), tagOpening({}, ["properties"]), "preview")).toBe(false);
    expect(displayShownOf(node(true), null, "preview")).toBe(false);
  });
});

describe("a row's preview", () => {
  let dom: InstalledDom;
  let container: HTMLDivElement;
  let root: Root;

  beforeAll(() => {
    dom = installDomGlobals();
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    syncUiPlugins([previewPlugin]);
  });

  afterAll(() => {
    syncUiPlugins([]);
    delete (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT;
    dom.restore();
  });

  beforeEach(() => {
    container = dom.window.document.createElement("div") as unknown as HTMLDivElement;
    dom.window.document.body.appendChild(container as unknown as never);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  async function draw(own: boolean | undefined, settings: Partial<DisplaySettings> = {}) {
    await act(async () => {
      root.render(
        createElement(RowPreview, { nodeId: "n.board", opening: opening(own, settings), depth: 0 }),
      );
    });
  }

  it("is drawn when it is opened after its row mounted", async () => {
    await draw(undefined);
    expect(container.querySelector("[data-row-preview]")).toBeNull();
    await draw(true);
    expect(container.querySelector("[data-test-preview]")).not.toBeNull();
    await draw(false);
    expect(container.querySelector("[data-row-preview]")).toBeNull();
  });

  it("is drawn where its family shows previews always, until the node's toggle hides it", async () => {
    await draw(undefined, { preview: "always" });
    expect(container.querySelector("[data-test-preview]")).not.toBeNull();
    await draw(false, { preview: "always" });
    expect(container.querySelector("[data-row-preview]")).toBeNull();
  });

  it("stands in a box of its family's height", async () => {
    await draw(true, { height: 240 });
    const box = container.querySelector<HTMLElement>("[data-row-preview] [role=button]");
    expect(box?.style.height).toBe("240px");
  });
});

describe("the tag chip's action", () => {
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
    container = dom.window.document.createElement("div") as unknown as HTMLDivElement;
    dom.window.document.body.appendChild(container as unknown as never);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("is a segment of the chip of the tag it names, and pressing it does not go to the tag", async () => {
    const run = vi.fn();
    const onTagClick = vi.fn();
    await act(async () => {
      root.render(
        createElement(TagChipGroup, {
          tags: [
            { id: "sys.tag.board", name: "board", color: "" },
            { id: "t.other", name: "other", color: "" },
          ],
          onTagClick,
          tagAction: { tag: "sys.tag.board", label: "Open in Board", icon: null, run },
        }),
      );
    });
    const actions = container.querySelectorAll<HTMLElement>("[data-tag-action]");
    expect(actions).toHaveLength(1);
    expect(actions[0]?.getAttribute("aria-label")).toBe("Open in Board");
    expect(actions[0]?.closest("[data-tag-chip]")?.textContent).toContain("board");
    await act(async () => actions[0]?.click());
    expect(run).toHaveBeenCalledTimes(1);
    expect(onTagClick).not.toHaveBeenCalled();
  });
});
