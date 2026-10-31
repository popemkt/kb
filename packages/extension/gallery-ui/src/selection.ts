/**
 * The page's facet selection, changed only by these: one style toggled, or
 * a visual's own styles taken as the selection. The selection is both the
 * filter (OR within a facet, AND across) and what the composer composes, so
 * choosing "low angle" and "golden hour" shows the references and the
 * prompt for them at once. It is read against the library as it is now
 * (`liveSelection`), so a style deleted or moved since it was chosen never
 * filters by where it used to be.
 */
import {
  filterVisuals,
  nearest,
  UNFILED,
  type FacetSelection,
  type GraphNode,
  type Library,
} from "@kb/gallery";

function facetOf(library: Library, styleId: string): string {
  return library.styles.get(styleId)?.facet ?? UNFILED;
}

/** `selection` with `styleId` chosen if it was not, unchosen if it was. */
export function toggleStyle(
  library: Library,
  selection: FacetSelection,
  styleId: string,
): FacetSelection {
  const facet = facetOf(library, styleId);
  const next = new Map(selection);
  const chosen = new Set(selection.get(facet) ?? []);
  if (chosen.has(styleId)) chosen.delete(styleId);
  else chosen.add(styleId);
  if (chosen.size === 0) next.delete(facet);
  else next.set(facet, chosen);
  return next;
}

/** A selection of exactly `styleIds`, each under its facet. */
export function selectionOf(library: Library, styleIds: readonly string[]): FacetSelection {
  const next = new Map<string, Set<string>>();
  for (const id of styleIds) {
    if (!library.styles.has(id)) continue;
    const facet = facetOf(library, id);
    const chosen = next.get(facet) ?? new Set<string>();
    chosen.add(id);
    next.set(facet, chosen);
  }
  return next;
}

/** Every chosen style, across facets. */
export function chosenStyles(selection: FacetSelection): ReadonlySet<string> {
  const all = new Set<string>();
  for (const chosen of selection.values()) for (const id of chosen) all.add(id);
  return all;
}

/** `selection` as the library files it now: each chosen style under its facet, a deleted one dropped. */
export function liveSelection(library: Library, selection: FacetSelection): FacetSelection {
  return selectionOf(library, [...chosenStyles(selection)]);
}

/**
 * The references a look's styles ask for: `every` visual while it has no
 * styles, `all` those that show every one of them, or, when none does and
 * nothing is typed, the ones that show `most`; `none` when nothing is left.
 */
export interface References {
  readonly visuals: readonly GraphNode[];
  readonly match: "every" | "all" | "most" | "none";
}

/** The references for `styles` and the search `text`, as {@link References} says. */
export function referencesOf(
  library: Library,
  styles: readonly string[],
  text: string,
): References {
  const all = filterVisuals(library, selectionOf(library, styles), text);
  if (all.length > 0) return { visuals: all, match: styles.length === 0 ? "every" : "all" };
  if (styles.length === 0 || text.trim() !== "") return { visuals: all, match: "none" };
  const byId = new Map(library.visuals.map((v) => [v.id, v]));
  const most = nearest(library, styles).flatMap((id) => byId.get(id) ?? []);
  return { visuals: most, match: most.length > 0 ? "most" : "none" };
}
