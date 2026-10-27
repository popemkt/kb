/**
 * The page's facet selection, changed only by these: one style toggled, or
 * a visual's own styles taken as the selection. The selection is both the
 * filter (OR within a facet, AND across) and what the composer composes, so
 * choosing "low angle" and "golden hour" shows the references and the
 * prompt for them at once.
 */
import { UNFILED, type FacetSelection, type Library } from "@kb/gallery";

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
