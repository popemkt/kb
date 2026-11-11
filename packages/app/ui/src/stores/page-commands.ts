/**
 * What a command reads and drives of the page (`OutlineCommandApi`), read
 * now: the zoom, the scope and the graph from the graph store, the rows and
 * the reveal from the projection the page stands in, the selection from its
 * editor, and the frame views from the UI kernel. Both palettes run commands
 * against it, so the context is built in one place (`pageCommandContext`),
 * and the node menu reads it through the page's host (`nodeCommands`).
 */
import {
  providedFrameViews,
  toast,
  type CommandContext,
  type CommandTarget,
  type OutlineCommandApi,
  type PaletteSurface,
} from "@kb/ui-sdk";
import { commandTargetNodeId, runCommand, viewTargetFrameId } from "@/lib/commands";
import { pageProjection, useGraphStore } from "@/stores/graph.store";
import { pageRows } from "@/stores/page";
import { useDebugFieldsStore } from "@/stores/debug-fields.store";
import { pageEditor } from "@/stores/page-editor";
import { usePrefsStore } from "@/stores/prefs.store";
import { useUiStore } from "@/stores/ui.store";
import { currentWorkspace } from "@/stores/workspace.store";

export function pageCommandApi(): OutlineCommandApi {
  const graph = useGraphStore.getState();
  return {
    selectedNodeId: pageEditor().getState().selectedNodeId,
    rootNodeId: graph.rootNodeId,
    ontologyId: graph.ontologyId,
    nodes: pageRows(),
    wireNodes: graph.wireNodes,
    jumpToNode: pageProjection().reveal,
    zoomTo: graph.zoomTo,
    leaveScope: graph.leaveScope,
    frameViews: providedFrameViews,
  };
}

/**
 * The state a command runs against, read at the moment it is built: what it
 * is about (`target`), the page, the preferences, the shell's ui switches,
 * the debug fields, the workspace, and the palette it runs from. The
 * registry is a leaf module (`lib/` reads no store), so the stores reach it
 * through this.
 */
export function pageCommandContext(target: CommandTarget, palette: PaletteSurface): CommandContext {
  return {
    target,
    outline: pageCommandApi(),
    prefs: usePrefsStore.getState(),
    ui: useUiStore.getState(),
    debugFields: useDebugFieldsStore.getState(),
    workspace: currentWorkspace(),
    palette,
  };
}

/**
 * What a command run from ⌘K or a key is about: the node `nodeId`, or the
 * page's own target when null (the selected row, else the zoomed node),
 * and the frame a view command edits.
 */
export function pageCommandTarget(nodeId: string | null = null): CommandTarget {
  const outline = pageCommandApi();
  return { nodeId: nodeId ?? commandTargetNodeId(outline), frameId: viewTargetFrameId(outline) };
}

/**
 * Run `command` from a key, about `nodeId` or the page's own target: as ⌘K
 * runs it, with no palette to close, and a picker step it would open told
 * as needing the node palette.
 */
export function runKeyCommand(command: string, nodeId: string | null): Promise<void> {
  return runCommand(
    command,
    pageCommandContext(pageCommandTarget(nodeId), {
      close: () => {},
      openStep: () => toast("That command needs the node palette"),
    }),
  );
}
