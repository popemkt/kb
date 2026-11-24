/**
 * The workspace: the layout open as the whole screen (DESIGN-UI.md → Panes
 * and layouts). Its arrangement is a kb layout tree (`@kb/views`), and which
 * pane has the focus is the workspace's too. Both are per device, kept in
 * localStorage["kb-workspace"]; "Save workspace" writes the arrangement as a
 * layout node, opening one replaces it, and "Save to layout" writes it back
 * to the layout node it was opened from or saved as.
 *
 * The URL names the focused pane: the address bar shows that pane's location,
 * a navigation moves that pane, and moving the focus shows the newly focused
 * pane's location without a history entry (`startWorkspace` keeps the two in
 * step).
 */
import { Result } from "effect";
import { SYSTEM_IDS } from "@kb/model";
import { create } from "zustand";
import {
  closePane,
  decodeLayout,
  findPane,
  freshPaneId,
  layoutPanes,
  neighbourOf,
  openBeside,
  sameLayout,
  singlePane,
  withPanePath,
  issueText,
  LayoutView,
  type LayoutTree,
  nodePath,
  viewNodeFor,
} from "@kb/views";
import {
  browserHost,
  getPath,
  MAIN_PANE,
  navigate,
  outlineLocationOf,
  replacePath,
  subscribePath,
} from "@kb/ui-sdk";
import { useUiStore } from "@/stores/ui.store";

// off-graph: device-local — the arrangement of panes is this screen's; "Save workspace" writes one to the store as a node
export const WORKSPACE_STORAGE_KEY = "kb-workspace";

interface Workspace {
  readonly layout: LayoutTree;
  /** The pane the URL names, where a navigation lands and keys type. */
  readonly focused: string;
  /** The layout node the arrangement was opened from or saved as: where "Save to layout" writes. */
  readonly from: string | null;
}

interface WorkspaceStore extends Workspace {
  /** Open `path` in a new pane to the right of `beside`, and focus it; returns its id. */
  openBeside: (beside: string, path: string) => string;
  /** Show `path` in pane `id`. */
  navigatePane: (id: string, path: string) => void;
  /** Close pane `id`; the last pane stays. */
  close: (id: string) => void;
  focus: (id: string) => void;
  /** Take an arrangement the grid reports (a drag, a resize, a tab switch). */
  arrange: (layout: LayoutTree) => void;
  /** Replace the workspace with a saved layout (the node `from`, when it is one), focusing its first pane. */
  replace: (layout: LayoutTree, from?: string | null) => void;
  /** Keep the arrangement as a layout node named `text` (`saveWorkspace`); its id, or null. */
  save: (text: string) => Promise<string | null>;
  /** Write the arrangement back to the layout node `from` (`saveToLayout`); whether it was written. */
  saveToLayout: () => Promise<boolean>;
}

function currentPath(): string {
  return typeof window === "undefined" ? "/" : getPath();
}

function fresh(): Workspace {
  return {
    layout: singlePane({ id: MAIN_PANE, path: currentPath() }),
    focused: MAIN_PANE,
    from: null,
  };
}

/** What this device last had open, or one pane at the URL. */
function load(): Workspace {
  try {
    const raw = window.localStorage.getItem(WORKSPACE_STORAGE_KEY);
    if (raw === null) return fresh();
    const stored: unknown = JSON.parse(raw);
    if (typeof stored !== "object" || stored === null || !("layout" in stored)) return fresh();
    const layout = decodeLayout(stored.layout);
    if (Result.isFailure(layout)) return fresh();
    const focused =
      "focused" in stored &&
      typeof stored.focused === "string" &&
      findPane(layout.success, stored.focused) !== undefined
        ? stored.focused
        : (layoutPanes(layout.success)[0]?.id ?? MAIN_PANE);
    const from = "from" in stored && typeof stored.from === "string" ? stored.from : null;
    // The URL names the focused pane, so it wins over what was stored.
    return { layout: withPanePath(layout.success, focused, currentPath()), focused, from };
  } catch {
    return fresh();
  }
}

function save({ layout, focused, from }: Workspace): void {
  try {
    window.localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify({ layout, focused, from }));
  } catch {
    // A device that cannot store keeps the arrangement for this page load.
  }
}

/** The location pane `id` shows. */
function pathOf(workspace: Workspace, id: string): string | undefined {
  return findPane(workspace.layout, id)?.path;
}

export const useWorkspaceStore = create<WorkspaceStore>((set, get) => {
  const commit = (next: Workspace): void => {
    const now = get();
    if (
      next.focused === now.focused &&
      next.from === now.from &&
      sameLayout(next.layout, now.layout)
    ) {
      return;
    }
    set(next);
    save(next);
    // The address bar follows the focus, without a history entry.
    const path = pathOf(next, next.focused);
    if (path !== undefined && next.focused !== now.focused) replacePath(path);
  };
  return {
    ...(typeof window === "undefined" ? fresh() : load()),

    openBeside: (beside, path) => {
      const { layout } = get();
      const id = freshPaneId(layout);
      commit({ ...get(), layout: openBeside(layout, beside, { id, path }), focused: id });
      return id;
    },

    navigatePane: (id, path) => {
      const now = get();
      // A pane the workspace does not hold (one inside a dashboard) moves the
      // focused pane, which holds it. The focused pane moves by the URL, so
      // its step is in the history.
      if (id === now.focused || findPane(now.layout, id) === undefined) navigate(path);
      else commit({ ...now, layout: withPanePath(now.layout, id, path) });
    },

    close: (id) => {
      const now = get();
      const layout = closePane(now.layout, id);
      if (sameLayout(layout, now.layout)) return;
      const focused =
        now.focused === id ? (neighbourOf(now.layout, id) ?? now.focused) : now.focused;
      commit({ ...now, layout, focused });
    },

    focus: (id) => {
      const now = get();
      if (findPane(now.layout, id) !== undefined) commit({ ...now, focused: id });
    },

    arrange: (layout) => {
      const now = get();
      const focused =
        findPane(layout, now.focused) === undefined
          ? (layoutPanes(layout)[0]?.id ?? MAIN_PANE)
          : now.focused;
      commit({ ...now, layout, focused });
    },

    replace: (layout, from = null) => {
      const focused = layoutPanes(layout)[0]?.id ?? MAIN_PANE;
      commit({ layout, focused, from });
    },

    save: async (text) => {
      const id = await saveWorkspace(get().layout, text);
      // The node just written is the one the arrangement is now kept as.
      if (id !== null) commit({ ...get(), from: id });
      return id;
    },

    saveToLayout: () => {
      const { layout, from } = get();
      return from === null ? Promise.resolve(false) : saveToLayout(layout, from);
    },
  };
});

/** The workspace now, for a reader outside React (a command's context). */
export function currentWorkspace(): WorkspaceStore {
  return useWorkspaceStore.getState();
}

/**
 * The live arrangement as a layout to keep: a pane at a zoom of the outline
 * keeps the node it is zoomed to (`/node/<id>`), since a zoom is where a
 * pane stands for now and a saved layout names the nodes its panes show.
 */
function keptLayout(layout: LayoutTree): LayoutTree {
  return layoutPanes(layout).reduce((kept, pane) => {
    const zoom = outlineLocationOf(pane.path)?.zoom ?? null;
    return zoom === null ? kept : withPanePath(kept, pane.id, nodePath(zoom));
  }, layout);
}

/**
 * "Save workspace": write the live arrangement as a layout node named
 * `text`, through `view.propose` — the one check of a proposed view, so the
 * UI saves exactly what an agent could propose. Filed in the Views list,
 * where it can be pinned. Returns the node's id, or null when it was refused.
 */
async function saveWorkspace(layout: LayoutTree, text: string): Promise<string | null> {
  const root = keptLayout(layout);
  const proposed = await browserHost().writes.proposeView({
    view: LayoutView,
    params: { root },
    text,
  });
  // Refused, the write path has said why.
  if ("refused" in proposed) return null;
  useUiStore.getState().pushToast("info", `Saved the workspace as “${text}”, in Views`);
  return proposed.id;
}

/**
 * "Save to layout": write the live arrangement back to layout node `node`,
 * the one it was opened from or saved as, through the one check of a
 * layout's settings (`viewNodeFor`, the check `view.propose` makes), as a
 * chart writes its spec back. The node's text, its place and what names it
 * stay as they are. False, saying why, when it was refused.
 */
async function saveToLayout(layout: LayoutTree, node: string): Promise<boolean> {
  const checked = viewNodeFor(LayoutView, { root: keptLayout(layout) }, null);
  if (Result.isFailure(checked)) {
    useUiStore
      .getState()
      .pushToast(
        "error",
        `Could not save to the layout: ${checked.failure.map(issueText).join("; ")}`,
      );
    return false;
  }
  const values = checked.success.props[SYSTEM_IDS.layoutField] ?? [];
  await browserHost().writes.replaceField(node, SYSTEM_IDS.layoutField, values);
  useUiStore.getState().pushToast("info", "Saved the workspace to its layout");
  return true;
}

/**
 * Keep the focused pane and the URL in step: a navigation (a link, a
 * command, back and forward) moves the focused pane. Returns the unsubscribe.
 */
export function startWorkspace(): () => void {
  const follow = (): void => {
    const now = useWorkspaceStore.getState();
    const { layout, focused } = now;
    const path = getPath();
    if (pathOf(now, focused) === path) return;
    useWorkspaceStore.getState().arrange(withPanePath(layout, focused, path));
  };
  follow();
  return subscribePath(follow);
}
