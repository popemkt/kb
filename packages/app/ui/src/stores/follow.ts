import {
  type Follow,
  type FollowFrom,
  type FollowHow,
  type FollowTarget,
  dateTarget,
  nodePath,
  nodeTarget,
  toast,
  useFollowThrough,
} from "@kb/ui-sdk";
import { pageProjection, useGraphStore } from "@/stores/graph.store";
import { useWorkspaceStore } from "@/stores/workspace.store";

/**
 * Carry out a follow (`lib/follow`): a node opens as the pane's page, is
 * revealed in place, or opens in a new pane beside this one; a location
 * outside the graph opens in a new tab; a date is followed to the node the
 * page's date target answers for it (`dateTarget`), if any.
 *
 * It lives beside the store rather than with a component because the
 * surfaces that render pointers — `MdView`, the node text host, a value slot —
 * are primitives: they take the handler as a prop, and every surface wants the
 * same one. One owner, every call site.
 */
export function useFollow(): Follow {
  return useFollowThrough(followFrom);
}

/**
 * The body of a follow, outside React: from `pane`, opening a node with
 * `open` (`OpenNodeContext`), else the outline's zoom. `useFollow` and the
 * page's `BrowserHost` both carry a follow out through it.
 */
export function followFrom(at: FollowFrom, target: FollowTarget, how: FollowHow): void {
  if (target.kind === "href") {
    window.open(target.href, "_blank", "noopener,noreferrer");
    return;
  }
  if (target.kind === "date") {
    void dateTarget(target.date).then(
      (id) => {
        if (id !== null) followFrom(at, nodeTarget(id), how);
      },
      // The role rejects only when no candidate answered, which only a
      // missing or failing default can cause: tell the owner, and lead nowhere.
      (error: unknown) =>
        toast(
          `Could not follow ${target.date}: ${error instanceof Error ? error.message : String(error)}`,
        ),
    );
    return;
  }
  if (how === "beside") useWorkspaceStore.getState().openBeside(at.pane, nodePath(target.id));
  else if (how === "reveal") pageProjection().reveal(target.id);
  else (at.open ?? useGraphStore.getState().zoomTo)(target.id);
}
