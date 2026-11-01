/**
 * "Open with…" (DESIGN-UI.md → Opening a node): the node menu offers each
 * way this page can open the target, the one it opens in by default marked;
 * the view a tag of it names, its tag opening, is "Open in …" and leads the
 * menu. Running a row moves the focused pane there and writes nothing. With
 * the canvas family off, a canvas is offered no canvas. After "Open in …",
 * the menu shows or hides each display option the opening offers.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  SYSTEM_IDS,
  displayDefaultId,
  displaySettingIds,
  present,
  type PropValue,
} from "@kb/model";
import { OUTLINE_IDS } from "@kb/outline";
import type { WireNode } from "@kb/contracts";
import { bundledSeed } from "@kb/bundled";
import { canvasUiPlugin } from "@kb/canvas-ui";
import { outlineUiPlugin, useOutlineStore } from "@kb/outline-ui";
import { getPath, navigate, syncUiPlugins, type CommandContext } from "@kb/ui-sdk";
import { singlePane } from "@kb/views";
import { installDomGlobals, type InstalledDom } from "@kb/ui-test-kit";
import { browserHostUiPlugin } from "@/browser-host";
import { layoutUiPlugin } from "@/components/layout/plugin";
import {
  commandTargetNodeId,
  listNodeCommands,
  runCommand,
  viewTargetFrameId,
} from "@/lib/commands";
import { useDebugFieldsStore } from "@/stores/debug-fields.store";
import { useGraphStore } from "@/stores/graph.store";
import { pageCommandApi } from "@/stores/page-commands";
import { usePrefsStore } from "@/stores/prefs.store";
import { useUiStore } from "@/stores/ui.store";
import { useWorkspaceStore } from "@/stores/workspace.store";
import { resetOutlineStore } from "@/test-support/outline-store";

const AT = "2026-10-31T00:00:00.000Z";
const tagged = (tag: string): Record<string, PropValue[]> => ({
  [SYSTEM_IDS.typeField]: [{ t: "ref", v: tag }],
});

function graph(extra: Record<string, WireNode["props"]> = {}): WireNode[] {
  const node = (id: string, props: WireNode["props"]): WireNode => ({
    id,
    text: id,
    props,
    children: [],
    createdAt: AT,
    updatedAt: AT,
  });
  const seeded = bundledSeed(AT).map((n) => ({ ...n }));
  const root = present(
    seeded.find((n) => n.id === SYSTEM_IDS.viewsRoot),
    "seeded",
  );
  const over = (n: WireNode): WireNode =>
    extra[n.id] === undefined ? n : { ...n, props: { ...n.props, ...extra[n.id] } };
  return [...seeded, node("n.board", tagged("sys.tag.canvas")), node("n.plain", {}), root]
    .filter((n, i, all) => all.findIndex((m) => m.id === n.id) === i)
    .map(over);
}

function context(): CommandContext {
  const outline = pageCommandApi();
  return {
    target: { nodeId: commandTargetNodeId(outline), frameId: viewTargetFrameId(outline) },
    outline,
    prefs: usePrefsStore.getState(),
    ui: useUiStore.getState(),
    debugFields: useDebugFieldsStore.getState(),
    workspace: useWorkspaceStore.getState(),
    palette: { close: () => {}, openStep: () => {} },
  };
}

function offered(nodeId: string, prefix = "open-with:") {
  useOutlineStore.setState({ selectedNodeId: nodeId });
  return listNodeCommands(context()).filter((c) => c.id.startsWith(prefix));
}

describe("Open with…", () => {
  let dom: InstalledDom;
  beforeEach(() => {
    dom = installDomGlobals();
    resetOutlineStore();
    useGraphStore.getState().hydrateFromWire(graph(), 1, "fixtures");
    navigate("/");
    useWorkspaceStore.setState({ layout: singlePane({ id: "main", path: "/" }), focused: "main" });
  });
  afterEach(() => {
    syncUiPlugins([]);
    dom.restore();
  });

  it("leads a canvas's menu with its canvas, then offers the outline", async () => {
    syncUiPlugins([browserHostUiPlugin, outlineUiPlugin, canvasUiPlugin, layoutUiPlugin]);
    useOutlineStore.setState({ selectedNodeId: "n.board" });
    expect(listNodeCommands(context())[0]?.label).toBe("Open in Canvas");
    const labels = offered("n.board").map((c) => c.label);
    expect(labels).toContain("Open with: Outline");
    const outline = present(
      offered("n.board").find((c) => c.label === "Open with: Outline"),
      "the outline row",
    );
    // The focused pane moves by the URL, so the step is in the history.
    await runCommand(outline.id, context());
    expect(getPath()).toBe("/node/n.board/sys.view.outline.main");
  });

  it("marks the outline the default of a plain node, and offers no canvas with the family off", () => {
    syncUiPlugins([browserHostUiPlugin, outlineUiPlugin, layoutUiPlugin]);
    expect(offered("n.board").map((c) => c.label)).not.toContain("Open in Canvas");
    expect(offered("n.plain").map((c) => c.label)).toContain("Open with: Outline (default)");
  });
});

describe("the display toggles in the node menu", () => {
  let dom: InstalledDom;
  const toggles = (nodeId: string) => offered(nodeId, "outline.display.").map((c) => c.label);
  const settings = displaySettingIds("canvas.page");
  beforeEach(() => {
    dom = installDomGlobals();
    resetOutlineStore();
    syncUiPlugins([browserHostUiPlugin, outlineUiPlugin, canvasUiPlugin, layoutUiPlugin]);
  });
  afterEach(() => {
    syncUiPlugins([]);
    dom.restore();
  });
  const hydrate = (extra: Record<string, WireNode["props"]> = {}) =>
    useGraphStore.getState().hydrateFromWire(graph(extra), 1, "fixtures");

  it('follow "Open in Canvas" on a canvas, each saying whether the node shows it', () => {
    hydrate();
    useOutlineStore.setState({ selectedNodeId: "n.board" });
    expect(
      listNodeCommands(context())
        .slice(0, 3)
        .map((c) => c.label),
    ).toEqual(["Open in Canvas", "Show preview", "Show properties"]);
    expect(toggles("n.plain")).toEqual([]);
    hydrate({
      "n.board": {
        ...tagged("sys.tag.canvas"),
        [OUTLINE_IDS.displayFields.preview]: [{ t: "bool", v: true }],
      },
    });
    expect(toggles("n.board")).toEqual(["Hide preview", "Show properties"]);
  });

  it("say what the canvas family's settings show, where the node says nothing", () => {
    hydrate({
      "sys.extension.canvas": {
        [settings.properties]: [{ t: "ref", v: displayDefaultId(settings.properties, "always") }],
      },
    });
    expect(toggles("n.board")).toEqual(["Show preview", "Hide properties"]);
  });
});
