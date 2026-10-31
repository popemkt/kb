/**
 * The readings Capture works with, pure over the library and the text: which
 * text is a link worth keeping, what the inbox holds (the visuals with no
 * styles, a reading, never stored) and which of it comes next, and a typed
 * word's suggestions grouped by facet.
 */
import { GALLERY_IDS, type GraphNode, type Library, type StyleEntry } from "@kb/gallery";

/** The picture types a link may end in to be taken for an image without asking. */
const IMAGE_PATH = /\.(?:jpe?g|png|webp|gif|avif|svg)$/i;

/** A link a capture keeps: the URL, and what the visual is called. */
export interface CapturedLink {
  readonly url: string;
  readonly name: string;
}

/**
 * `text` as a link to keep: one https URL, nothing around it. `image`
 * asks that its path end in a picture's extension, as a paste is taken
 * only then; a link typed into the field is the person saying it is one.
 */
export function linkOf(text: string, image: boolean): CapturedLink | null {
  const trimmed = text.trim();
  if (trimmed === "" || /\s/.test(trimmed)) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.hostname === "") return null;
  if (image && !IMAGE_PATH.test(url.pathname)) return null;
  const last = url.pathname.split("/").findLast((part) => part !== "") ?? "";
  let name = last;
  try {
    name = decodeURIComponent(last);
  } catch {
    // A malformed escape is kept as written.
  }
  return { url: url.href, name: name === "" ? url.hostname : name };
}

/** What `node.add` takes for a link kept as a visual: its source, and no media. */
export function linkVisualInput(link: CapturedLink, parent: string | null) {
  return {
    text: link.name,
    tags: [GALLERY_IDS.visualTag],
    ...(parent === null ? {} : { parent }),
    props: [{ field: GALLERY_IDS.sourceField, value: { t: "str" as const, v: link.url } }],
  };
}

/** The inbox: the visuals with no styles yet, in library order. */
export function untriagedOf(library: Library): readonly GraphNode[] {
  return library.visuals.filter((v) => (library.stylesOf.get(v.id) ?? []).length === 0);
}

/** Suggestions under one facet; `facet` null for the styles no facet holds. */
export interface SuggestionGroup {
  readonly facet: { readonly id: string; readonly text: string } | null;
  readonly styles: readonly StyleEntry[];
}

/**
 * Ranked suggestions grouped by facet, the groups in the order their best
 * suggestion ranks, so the first style of the first group is the top one.
 */
export function groupByFacet(
  library: Library,
  ranked: readonly StyleEntry[],
): readonly SuggestionGroup[] {
  const groups = new Map<
    string | null,
    { facet: SuggestionGroup["facet"]; styles: StyleEntry[] }
  >();
  for (const style of ranked) {
    let group = groups.get(style.facet);
    if (group === undefined) {
      const facet = library.facets.find((f) => f.id === style.facet);
      group = {
        facet: facet === undefined ? null : { id: facet.id, text: facet.text },
        styles: [],
      };
      groups.set(style.facet, group);
    }
    group.styles.push(style);
  }
  return [...groups.values()];
}

/**
 * The visual triage moves to after `current`: the next untriaged one in
 * library order, wrapping, never `current` itself; null when none is left.
 */
export function nextUntriaged(library: Library, current: string | null): string | null {
  const visuals = library.visuals;
  const at = visuals.findIndex((v) => v.id === current);
  for (let step = 1; step <= visuals.length; step++) {
    const visual = visuals[(at + step + visuals.length) % visuals.length];
    if (visual === undefined || visual.id === current) continue;
    if ((library.stylesOf.get(visual.id) ?? []).length === 0) return visual.id;
  }
  return null;
}
