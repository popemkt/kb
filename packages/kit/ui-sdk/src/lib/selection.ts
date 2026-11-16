/**
 * What a gesture over a selection of rows is about (DESIGN-UI.md → Outline
 * editor, "A selection is a range of rows"): every row it marks or fills.
 * The top rows it moves or removes are `@kb/model`'s `selectionRoots`.
 */

/**
 * The rows a gesture at `target` is about: the whole selection when the
 * target is one of its rows, the target alone otherwise, none without one.
 */
export function rowsAbout(target: string | null, selected: readonly string[]): readonly string[] {
  if (target === null) return [];
  return selected.includes(target) ? selected : [target];
}
