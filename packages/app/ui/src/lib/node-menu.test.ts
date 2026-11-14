/**
 * The node menu (DESIGN-UI.md → The node menu) lists its commands by
 * group, then by order in the group, then in the order they came, so a
 * family's command takes its place among the shell's by saying where.
 *
 * "Open with…" (DESIGN-UI.md → Opening a node): the node menu offers each
 * way this page can open the target, the one it opens in by default marked;
 * the view a tag of it names, its tag opening, is "Open in …" and leads the
 * menu. Running a row moves the focused pane there and writes nothing. With
 * the canvas family off, a canvas is offered no canvas. After "Open in …",
 * the menu shows or hides each display option the opening offers.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
import { useOutlineStore } from "@kb/outline-ui";
import { outlineUiPlugin } from "@/test-support/outline-plugin";
import { bindPluginAuthority, definePlugin } from "@kb/plugin";
import {
  CommandPoint,
  ViewPoint,
  currentContributions,
  nodeMenu,
  paletteStepsPlugin,
  getPath,
  navigate,
  syncUiPlugins,
  type CommandContext,
} from "@kb/ui-sdk";
import { singlePane } from "@kb/views";
import { installDomGlobals, type InstalledDom } from "@kb/ui-test-kit";
import { browserHostUiPlugin } from "@/browser-host";
import { layoutUiPlugin } from "@/components/layout/plugin";
import {
  commandsFor,
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
/** A seeded tag, the canvas family's. */
const CANVAS_TAG = "sys.tag.canvas";
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
  return [...seeded, node("n.board", tagged(CANVAS_TAG)), node("n.plain", {}), root]
    .filter((n, i, all) => all.findIndex((m) => m.id === n.id) === i)
    .map(over);
}

function context(): CommandContext {
  const outline = pageCommandApi();
  return {
    target: {
      nodeId: commandTargetNodeId(outline),
      frameId: viewTargetFrameId(outline),
      nodeIds: [commandTargetNodeId(outline)].filter((id) => id !== null),
    },
    outline,
    prefs: usePrefsStore.getState(),
    ui: useUiStore.getState(),
    debugFields: useDebugFieldsStore.getState(),
    workspace: useWorkspaceStore.getState(),
    palette: { close: () => {}, openStep: () => {} },
  };
}

const toasts = () => useUiStore.getState().toasts.map((t) => t.text);

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
    syncUiPlugins([
      paletteStepsPlugin,
      browserHostUiPlugin,
      outlineUiPlugin,
      canvasUiPlugin,
      layoutUiPlugin,
    ]);
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
    syncUiPlugins([paletteStepsPlugin, browserHostUiPlugin, outlineUiPlugin, layoutUiPlugin]);
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
    syncUiPlugins([
      paletteStepsPlugin,
      browserHostUiPlugin,
      outlineUiPlugin,
      canvasUiPlugin,
      layoutUiPlugin,
    ]);
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

describe("the node menu's order", () => {
  let dom: InstalledDom;
  /** A family's command, placed by its `menu` alone. */
  const placed = definePlugin({
    name: "placed",
    apply: (ctx) =>
      ctx.contribute(CommandPoint, {
        id: "between",
        value: {
          id: "placed.between",
          menu: nodeMenu("make", 15),
          chrome: () => ({ label: "Placed between", icon: null }),
          run: () => {},
        },
      }),
  });
  beforeEach(() => {
    dom = installDomGlobals();
    resetOutlineStore();
    useGraphStore.getState().hydrateFromWire(graph(), 1, "fixtures");
  });
  afterEach(() => {
    syncUiPlugins([]);
    dom.restore();
  });

  it("is by group, then order: a contribution takes the place it names, and removing ends it", () => {
    syncUiPlugins([
      paletteStepsPlugin,
      browserHostUiPlugin,
      outlineUiPlugin,
      layoutUiPlugin,
      placed,
    ]);
    useOutlineStore.setState({ selectedNodeId: "n.plain" });
    const labels = listNodeCommands(context()).map((c) => c.label);
    expect(labels.slice(0, 4)).toEqual([
      "Add tag",
      "Placed between",
      "Turn into query",
      "Turn into reference…",
    ]);
    const at = (label: string) => labels.indexOf(label);
    expect(at("Open in panel")).toBeLessThan(at("Open with: Outline (default)"));
    expect(at("Open with: Outline (default)")).toBeLessThan(at("Indent"));
    expect(at("Indent")).toBeLessThan(at("Pin"));
    expect(at("Pin")).toBeLessThan(at("Filter…"));
    expect(labels.at(-1)).toBe("Delete node");
  });
});

describe("Make your own tag that extends this", () => {
  let dom: InstalledDom;
  beforeEach(() => {
    dom = installDomGlobals();
    resetOutlineStore();
    useGraphStore.getState().hydrateFromWire(graph(), 1, "fixtures");
    syncUiPlugins([paletteStepsPlugin, browserHostUiPlugin, outlineUiPlugin, layoutUiPlugin]);
  });
  afterEach(() => {
    syncUiPlugins([]);
    dom.restore();
  });

  it("is offered on a tag, and not on a node that is none", () => {
    expect(offered(CANVAS_TAG, "extend-tag").map((c) => c.label)).toEqual([
      "Make your own tag that extends this",
    ]);
    expect(offered("n.plain", "extend-tag")).toEqual([]);
  });

  it("makes the person's tag, extending this one, and opens it", async () => {
    const [command] = offered(CANVAS_TAG, "extend-tag");
    await runCommand(present(command, "the command").id, context());
    await new Promise((resolve) => setTimeout(resolve, 0));
    const mine = present(
      useGraphStore.getState().wireNodes.find((n) => n.text === "my canvas"),
      "the person's tag",
    );
    expect(mine.props[SYSTEM_IDS.typeField]).toEqual([{ t: "ref", v: SYSTEM_IDS.tag }]);
    expect(mine.props[SYSTEM_IDS.extendsField]).toEqual([{ t: "ref", v: CANVAS_TAG }]);
    expect(useGraphStore.getState().rootNodeId).toBe(mine.id);
  });
});

const duplicateProvider = (name: string, run: () => void, isOffered: boolean) =>
  definePlugin({
    name,
    apply: (ctx) =>
      ctx.contribute(CommandPoint, {
        id: "duplicate",
        value: {
          id: "duplicate",
          when: () => isOffered,
          menu: nodeMenu("make", 10),
          chrome: () => ({ label: name, icon: null }),
          run,
        },
      }),
  });

const conditionalProvider = (run: () => void) =>
  definePlugin({
    name: "conditional",
    apply: (ctx) =>
      ctx.contribute(CommandPoint, {
        id: "go",
        value: {
          id: "conditional.go",
          when: (commandContext) => commandContext.target.nodeId === "n.plain",
          menu: nodeMenu("make", 10),
          chrome: () => ({ label: "Conditional", icon: null }),
          run,
        },
      }),
  });

/** The kinds a row carries. */
const kinds = (id: string) =>
  useGraphStore.getState().wireNodes.find((n) => n.id === id)?.props[SYSTEM_IDS.typeField] ?? [];

describe("a node command over a range of rows", () => {
  let dom: InstalledDom;
  beforeEach(() => {
    dom = installDomGlobals();
    resetOutlineStore();
    useGraphStore.getState().hydrateFromWire(graph(), 1, "fixtures");
    syncUiPlugins([paletteStepsPlugin, browserHostUiPlugin, outlineUiPlugin, layoutUiPlugin]);
  });
  afterEach(() => {
    syncUiPlugins([]);
    dom.restore();
  });

  /** The context with `rows` selected, anchored at the last. */
  const over = (rows: readonly string[]): CommandContext => {
    const ctx = context();
    return { ...ctx, target: { ...ctx.target, nodeId: rows.at(-1) ?? null, nodeIds: rows } };
  };

  it("lists only the commands that act on each row", () => {
    const ids = listNodeCommands(over(["n.board", "n.plain"])).map((c) => c.id);
    expect(ids).not.toContain("make-supertag");
    expect(ids).toEqual(expect.arrayContaining(["add-tag", "toggle-pin", "delete"]));
  });

  it("offers Count words and Copy node ID over the range, read from every row", () => {
    const listed = listNodeCommands(over(["n.board", "n.plain"]));
    expect(listed.map((c) => c.id)).toEqual(
      expect.arrayContaining(["count-words", "copy-node-id", "move-to"]),
    );
    expect(listed.find((c) => c.id === "copy-node-id")?.label).toBe("Copy node IDs");
  });

  it("Copy node ID puts each row's id on the clipboard, one per line, and says so", async () => {
    const written: string[] = [];
    vi.stubGlobal("navigator", {
      clipboard: { writeText: (text: string) => Promise.resolve(void written.push(text)) },
    });
    try {
      await runCommand("copy-node-id", over(["n.board", "n.plain"]));
      await vi.waitFor(() => expect(toasts()).toContain("2 node IDs copied"));
      expect(written).toEqual(["n.board\nn.plain"]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("Count words says the words, characters and nodes of the rows, and writes nothing", async () => {
    const before = useGraphStore.getState().wireNodes;
    await runCommand("count-words", over(["n.board", "n.plain"]));
    expect(useUiStore.getState().toasts.at(-1)).toMatchObject({
      kind: "info",
      text: "2 words · 14 characters · 2 nodes",
    });
    expect(useGraphStore.getState().wireNodes).toBe(before);
  });

  it("runs a command that acts on one row, from its shortcut, on the head alone", async () => {
    await runCommand("make-supertag", over(["n.board", "n.plain"]));
    await vi.waitFor(() => expect(kinds("n.plain")).toEqual([{ t: "ref", v: SYSTEM_IDS.tag }]));
    expect(kinds("n.board")).toEqual([{ t: "ref", v: CANVAS_TAG }]);
  });
});

describe("runner catalog provenance", () => {
  let dom: InstalledDom;
  const base = [browserHostUiPlugin, paletteStepsPlugin, outlineUiPlugin, layoutUiPlugin];
  beforeEach(() => {
    dom = installDomGlobals();
    resetOutlineStore();
    useGraphStore.getState().hydrateFromWire(graph(), 1, "fixtures");
    useOutlineStore.setState({ selectedNodeId: "n.plain" });
    syncUiPlugins(base);
  });
  afterEach(() => {
    syncUiPlugins([]);
    dom.restore();
  });

  it("retains the actual page-only registration used by the normal runner", async () => {
    const ran = vi.fn();
    const pageOnly = definePlugin({
      name: "page-only",
      apply: (ctx) =>
        ctx.contribute(CommandPoint, {
          id: "go",
          value: {
            id: "page-only.go",
            menu: nodeMenu("make", 10),
            chrome: () => ({ label: "Go", icon: null }),
            run: ran,
          },
        }),
    });
    syncUiPlugins([...base, pageOnly]);
    const entry = present(
      commandsFor(context()).find(({ command }) => command.id === "page-only.go"),
      "live command",
    );
    expect(entry.source.kind).toBe("contribution");
    if (entry.source.kind !== "contribution") throw new Error("Expected plugin source");
    const registration = currentContributions(CommandPoint).find(
      ({ value }) => value.id === "page-only.go",
    );
    expect(entry.source.registration).toEqual(registration);
    expect(entry.source.registration.owner).toBe("page-only");
    expect(entry.source.provenance).toEqual({ root: "page-only", source: "bundled" });
    expect(entry.command).toBe(registration?.value);
    await runCommand(entry.command.id, context());
    expect(ran).toHaveBeenCalledOnce();
    syncUiPlugins(base);
    expect(commandsFor(context()).some(({ command }) => command.id === "page-only.go")).toBe(false);
    syncUiPlugins([...base, pageOnly]);
    expect(
      commandsFor(context()).filter(({ command }) => command.id === "page-only.go"),
    ).toHaveLength(1);
  });

  it("reads host-bound code provenance for an extension command without granting authority", () => {
    const digest = `sha256:${"a".repeat(64)}`;
    const plugin = bindPluginAuthority(
      duplicateProvider("installed", () => {}, true),
      {
        source: "extension",
        pointNamespace: "ext.installed",
        digest,
        replacements: [],
        defaults: [],
      },
    );
    syncUiPlugins([...base, plugin]);
    const entry = commandsFor(context()).find(({ command }) => command.id === "duplicate");
    expect(entry?.source.kind === "contribution" ? entry.source.provenance : undefined).toEqual({
      root: "installed",
      source: "extension",
      digest,
    });
    syncUiPlugins(base);
    expect(commandsFor(context()).some(({ command }) => command.id === "duplicate")).toBe(false);
  });

  it("does not turn writable command descriptions into runner entries", () => {
    const forged: WireNode = {
      id: "claimed.command",
      text: "Claimed",
      children: [],
      createdAt: AT,
      updatedAt: AT,
      props: {
        [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.command }],
        owner: [{ t: "ref", v: "sys.extension.core" }],
      },
    };
    useGraphStore.getState().hydrateFromWire([...graph(), forged], 2, "fixtures");
    expect(commandsFor(context()).some(({ command }) => command.id === forged.id)).toBe(false);
  });

  it("preserves first-registration dispatch even when later duplicates are offered", async () => {
    const first = vi.fn();
    const second = vi.fn();
    syncUiPlugins([
      ...base,
      duplicateProvider("first", first, false),
      duplicateProvider("second", second, true),
    ]);
    const entries = commandsFor(context()).filter(({ command }) => command.id === "duplicate");
    expect(
      entries.map(({ source }) =>
        source.kind === "contribution" ? source.registration.owner : source.kind,
      ),
    ).toEqual(["first", "second"]);
    expect(
      listNodeCommands(context())
        .filter(({ id }) => id === "duplicate")
        .map(({ label }) => label),
    ).toEqual(["second"]);
    await runCommand("duplicate", context());
    expect(first).toHaveBeenCalledOnce();
    expect(second).not.toHaveBeenCalled();
  });

  it("re-reads conditional availability and changed implementations without graph edits", async () => {
    const first = vi.fn();
    const replacement = vi.fn();
    syncUiPlugins([...base, conditionalProvider(first)]);
    const initial = present(
      commandsFor(context()).find(({ command }) => command.id === "conditional.go"),
      "initial",
    );
    expect(initial.command.when?.(context())).toBe(true);
    useOutlineStore.setState({ selectedNodeId: "n.board" });
    expect(initial.command.when?.(context())).toBe(false);
    expect(listNodeCommands(context()).some(({ id }) => id === initial.command.id)).toBe(false);
    syncUiPlugins(base);
    syncUiPlugins([...base, conditionalProvider(replacement)]);
    const changed = present(
      commandsFor(context()).find(({ command }) => command.id === initial.command.id),
      "replacement",
    );
    expect(changed.source).not.toEqual(initial.source);
    await runCommand(changed.command.id, context());
    expect(replacement).toHaveBeenCalledOnce();
    expect(first).not.toHaveBeenCalled();
  });

  it("retains live view providers and captured inputs of host-generated commands", () => {
    const catalog = commandsFor(context());
    const frame = present(
      catalog.find(({ command }) => command.id === SYSTEM_IDS.cmdViewAsList),
      "frame command",
    );
    expect(frame.source.kind).toBe("host");
    if (frame.source.kind !== "host") throw new Error("Expected host source");
    const dependency = present(frame.source.views[0], "view dependency");
    expect(frame.source.input).toEqual({ view: dependency.key.id });
    expect(dependency.registrations.map(({ registration }) => registration)).toEqual(
      currentContributions(ViewPoint).filter(({ value }) => value.key === dependency.key),
    );
    expect(dependency.registrations.length).toBeGreaterThan(0);
    const opening = present(
      catalog.find(({ command }) => command.id.startsWith("open-with:")),
      "opening",
    );
    expect(opening.source.kind).toBe("host");
    if (opening.source.kind !== "host") throw new Error("Expected host source");
    expect(opening.source.input.nodeId).toBe("n.plain");
    useOutlineStore.setState({ selectedNodeId: "n.board" });
    const moved = commandsFor(context()).find(({ command }) => command.id === opening.command.id);
    expect(moved?.source.kind === "host" ? moved.source.input.nodeId : undefined).toBe("n.board");
    expect(opening.source.input.nodeId).toBe("n.plain");
  });
});
