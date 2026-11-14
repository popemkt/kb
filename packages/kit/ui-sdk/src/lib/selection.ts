/**
 * What a gesture over a selection of rows is about (DESIGN-UI.md → Outline
 * editor, "A selection is a range of rows"): every row it marks or fills,
 * and the top rows it moves or removes.
 */
import type { NodeMap } from "./types";

/**
 * The rows a gesture at `target` is about: the whole selection when the
 * target is one of its rows, the target alone otherwise, none without one.
 */
export function rowsAbout(target: string | null, selected: readonly string[]): readonly string[] {
  if (target === null) return [];
  return selected.includes(target) ? selected : [target];
}

/**
 * The top rows of a selection: a selected row under another selected row
 * goes with it, so a move or a delete names only the rows no other selected
 * row holds: `ids`, in order, less every id another of them holds somewhere
 * above it in `nodes`.
 */
export function selectionRoots(ids: readonly string[], nodes: NodeMap): string[] {
  const chosen = new Set(ids);
  const heldAbove = (id: string): boolean => {
    const seen = new Set<string>([id]);
    let parent = nodes.get(id)?.parentId ?? null;
    while (parent !== null && !seen.has(parent)) {
      if (chosen.has(parent)) return true;
      seen.add(parent);
      parent = nodes.get(parent)?.parentId ?? null;
    }
    return false;
  };
  return [...new Set(ids)].filter((id) => !heldAbove(id));
}
