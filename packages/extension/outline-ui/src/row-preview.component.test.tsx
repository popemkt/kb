/**
 * A row's preview (DESIGN-UI.md → Opening a node → a tag's opening): the
 * opening's view at placement `preview`, which its key offers, in a box of
 * its settings' height, drawn when the node's own toggle opens it — or,
 * while the toggle says nothing, when the settings open previews — and drawn
 * when it is opened after its row mounted, not only when it starts open.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Effect } from "effect";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PREVIEW_DEFAULTS, type PreviewSettings } from "@kb/model";
import { OUTLINE_IDS } from "@kb/outline";
import { definePlugin } from "@kb/plugin";
import { NoParams, viewKey } from "@kb/views";
import { provideView, syncUiPlugins, ViewPoint, type OutlineNode } from "@kb/ui-sdk";
import { installDomGlobals, type InstalledDom } from "@kb/ui-test-kit";
import { RowOpeningActions, RowPreview } from "./row-preview";
import type { RowOpening } from "./row-opening";

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

function opening(preview: Partial<PreviewSettings> = {}): RowOpening {
  return {
    tag: "sys.tag.board",
    key: PreviewedView,
    picker: undefined,
    preview: { ...PREVIEW_DEFAULTS, ...preview },
    label: PreviewedView.label,
    icon: null,
  };
}

function node(shown?: boolean): OutlineNode {
  return {
    id: "n.board",
    text: "Board",
    props: shown === undefined ? {} : { [OUTLINE_IDS.previewField]: [{ t: "bool", v: shown }] },
    children: [],
  } as unknown as OutlineNode;
}

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

  async function draw(shown: boolean | undefined, settings: Partial<PreviewSettings> = {}) {
    await act(async () => {
      root.render(
        createElement(RowPreview, {
          nodeId: "n.board",
          node: node(shown),
          opening: opening(settings),
          depth: 0,
        }),
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

  it("starts open where its family opens previews, until the node's toggle closes it", async () => {
    await draw(undefined, { expanded: true });
    expect(container.querySelector("[data-test-preview]")).not.toBeNull();
    await draw(false, { expanded: true });
    expect(container.querySelector("[data-row-preview]")).toBeNull();
  });

  it("stands in a box of its family's height", async () => {
    await draw(true, { height: 240 });
    const box = container.querySelector<HTMLElement>("[data-row-preview] [role=button]");
    expect(box?.style.height).toBe("240px");
  });

  it("offers its toggle and its view on the row, the toggle saying whether it is open", async () => {
    await act(async () => {
      root.render(
        createElement(RowOpeningActions, {
          nodeId: "n.board",
          node: node(true),
          opening: opening(),
        }),
      );
    });
    expect(container.querySelector("[aria-expanded]")?.getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelector("[title='Open in Board']")).not.toBeNull();
  });
});
