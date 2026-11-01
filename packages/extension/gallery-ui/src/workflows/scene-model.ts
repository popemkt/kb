/**
 * The readings Scene draws (`scene.tsx`): its parts, what fills each, the
 * `#term` being typed in its field, and the order references are offered
 * in. Pure over the library and the look, so a test reads them as the page
 * does.
 */
import {
  axesOf,
  axisStyles,
  moreLike,
  type Axis,
  type Library,
  type StyleEntry,
} from "@kb/gallery";

/** The parts a scene is composed of: every axis the library has styles for. */
export function partsOf(library: Library): readonly Axis[] {
  return axesOf(library).filter((axis) => axis.facets.length > 0);
}

/** The styles of the look that fill `axis`, in composer order. */
export function filling(
  library: Library,
  axis: Axis,
  chosen: readonly string[],
): readonly StyleEntry[] {
  return axisStyles(library, axis).filter((s) => chosen.includes(s.id));
}

/** The `#term` being typed at `caret`, and where its `#` is; null when none is. */
export function hashTermAt(text: string, caret: number): { at: number; term: string } | null {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf("#");
  if (at === -1) return null;
  const term = before.slice(at + 1);
  return /[\n,#]/.test(term) ? null : { at, term };
}

/** The visuals offered as references: the pinned, then those most like them, then the rest. */
export function referenceOrder(library: Library, pinned: readonly string[]): readonly string[] {
  const like = pinned.flatMap((id) => moreLike(library, id));
  const order = [...pinned, ...like, ...library.visuals.map((v) => v.id)];
  return [...new Set(order)];
}
