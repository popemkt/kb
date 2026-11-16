/**
 * The top rows of a selection (DESIGN-UI.md → Outline editor, "A selection
 * is a range of rows"; DESIGN.md → Outline formats, the projection): what a
 * move, a delete or an export of several rows is about. Isomorphic, so the
 * page's gestures and the domain's export pick the same rows.
 */
import type { NodeId } from "./model.ts";

/**
 * The top rows of a selection: a selected row under another selected row
 * goes with it, so a move, a delete or an export names only the rows no
 * other selected row holds: `ids`, in order and each once, less every id
 * another of them holds somewhere above it, as `parentOf` reads each node's
 * parent (null or undefined at the top).
 */
export function selectionRoots(
  ids: readonly NodeId[],
  parentOf: (id: NodeId) => NodeId | null | undefined,
): NodeId[] {
  const chosen = new Set(ids);
  const heldAbove = (id: NodeId): boolean => {
    const seen = new Set<NodeId>([id]);
    let parent = parentOf(id) ?? null;
    while (parent !== null && !seen.has(parent)) {
      if (chosen.has(parent)) return true;
      seen.add(parent);
      parent = parentOf(parent) ?? null;
    }
    return false;
  };
  return [...new Set(ids)].filter((id) => !heldAbove(id));
}
