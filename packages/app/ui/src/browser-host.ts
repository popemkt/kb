/**
 * The page's `BrowserHost` (DESIGN-UI.md → Extension UI halves), bound to the
 * shell's stores, write path, invoke path and sandbox host. A built-in plugin
 * provides it to the UI kernel. Feature plugins inject it, so they apply only
 * once it is there, and they reach the shell through it alone.
 */
import { coreExtension } from "@kb/operations";
import { familyTags } from "@kb/contracts";
import { definePlugin } from "@kb/plugin";
import { mutations } from "@/actions/mutations";
import { listNodeCommands } from "@/lib/commands";
import { proposeView } from "@/lib/propose-view";
import { pageCatalog } from "@/lib/view-catalog";
import { BrowserHostService, type BrowserHost } from "@kb/ui-sdk";
import { hostSandboxFrame, invokeAsScript, isTrusted, setTrusted } from "@/lib/sandbox-host";
import { invoke } from "@/session/runtime";
import { reachedState, useGraphStore } from "@/stores/graph.store";
import { pageRows, subscribePage } from "@/stores/page";
import { useDebugFieldsStore } from "@/stores/debug-fields.store";
import { useDesignSystemStore } from "@/stores/design-system.store";
import { pageCommandContext } from "@/stores/page-commands";
import { pageEditor } from "@/stores/page-editor";
import { appearanceIn, usePrefsStore } from "@/stores/prefs.store";
import { nodeTextPort } from "@/stores/node-text-port";
import { refInkIn } from "@/stores/ref-ink";
import { paneScreenPort } from "@/stores/screen.store";
import { useUiStore } from "@/stores/ui.store";
import { useWorkspaceStore } from "@/stores/workspace.store";

/**
 * The stores the host's reads answer from, beside the page itself (its graph,
 * projection and editor, `subscribePage`).
 */
const SOURCES = [usePrefsStore, useDesignSystemStore, useUiStore, useDebugFieldsStore] as const;

const host: BrowserHost = {
  // A node text port is what the shell binds its own text hosts through, so
  // the host is that port, listened to over every store its reads answer from.
  ...nodeTextPort,
  subscribe: (listener) => {
    const unsubscribes = [
      subscribePage(listener),
      ...SOURCES.map((store) => store.subscribe(listener)),
    ];
    return () => {
      for (const unsubscribe of unsubscribes) unsubscribe();
    };
  },
  node: (id) => pageRows().get(id),
  isActive: (nodeId, instanceKey) => {
    const { activeNodeId, activeInstanceKey } = pageEditor().getState();
    return activeNodeId === nodeId && activeInstanceKey === instanceKey;
  },
  editing: () => pageEditor().getState().activeNodeId !== null,
  events: () => useUiStore.getState().events,
  isSelected: (nodeId, instanceKey) => {
    const { selectedNodeId, selectedInstanceKey } = pageEditor().getState();
    return selectedNodeId === nodeId && selectedInstanceKey === instanceKey;
  },
  toggleCollapse: (nodeId) => pageEditor().getState().toggleCollapse(nodeId),
  wireNodes: () => useGraphStore.getState().wireNodes,
  appearance: () => appearanceIn(useDesignSystemStore.getState().painted, usePrefsStore.getState()),
  prefs: () => usePrefsStore.getState(),
  refInk: () => refInkIn(useGraphStore.getState()),
  zoomTo: (id) => useGraphStore.getState().zoomTo(id),
  zoomHome: () => useGraphStore.getState().zoomHome(),
  graph: {
    state: () => useGraphStore.getState(),
    subscribe: (listener) => useGraphStore.subscribe(listener),
    reach: (id) => useGraphStore.getState().reach(id),
    reached: reachedState,
    drop: (id) => useGraphStore.getState().applyTx([], [id]),
  },
  debugFields: {
    ids: () => useDebugFieldsStore.getState().ids,
    toggle: (nodeId) => useDebugFieldsStore.getState().toggle(nodeId),
  },
  viewSettingsFrame: () => useUiStore.getState().viewSettingsFrameId,
  setViewSettingsFrame: (frameId) => useUiStore.getState().setViewSettingsFrameId(frameId),
  nodePaletteOpen: () => useUiStore.getState().nodePaletteOpen,
  nodeCommands: (target, palette) => listNodeCommands(pageCommandContext(target, palette)),
  activateNode: (nodeId, cursorPos, instanceKey) =>
    pageEditor().getState().activateNode(nodeId, cursorPos, instanceKey),
  navigatePane: (pane, path) => useWorkspaceStore.getState().navigatePane(pane, path),
  viewCatalog: pageCatalog,
  writes: mutations,
  invoke,
  screen: paneScreenPort,
  proposeView,
  sandbox: { hostFrame: hostSandboxFrame, invokeAsScript, isTrusted, setTrusted },
};

export const browserHostUiPlugin = definePlugin({
  name: "host",
  tags: familyTags(coreExtension, "ui"),
  apply: (ctx) => ctx.provide(BrowserHostService, host),
});
