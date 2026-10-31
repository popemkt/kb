/**
 * The library as the gallery reads it from the graph: which nodes are
 * visuals, which styles they show, which facet each style belongs to, and
 * the faceted filter over them. Pure over the node set, so the page computes
 * it from its replica and a test from a fixture, with no store and no query.
 *
 * A style's facet is a reading of structure, not a field: the nearest
 * ancestor tagged `#facet` (research record §4). No field duplicates it, so
 * moving a style under another facet re-files it everywhere at once.
 */
import { SYSTEM_IDS, assetEmbedsOf, type PropValue } from "@kb/model";
import { GALLERY_IDS } from "./ids.ts";

/** What the library reads of a node: the shape a stored node and a page node share. */
export interface GraphNode {
  readonly id: string;
  readonly text: string;
  readonly props: Readonly<Record<string, readonly PropValue[] | undefined>>;
  readonly children: readonly string[];
}

export function isTagged(node: GraphNode, tagId: string): boolean {
  return node.props[SYSTEM_IDS.typeField]?.some((v) => v.t === "ref" && v.v === tagId) ?? false;
}

function strings(node: GraphNode, fieldId: string): readonly string[] {
  return (node.props[fieldId] ?? []).flatMap((v) => (v.t === "str" ? [v.v] : []));
}

function refs(node: GraphNode, fieldId: string): readonly string[] {
  return (node.props[fieldId] ?? []).flatMap((v) => (v.t === "ref" ? [v.v] : []));
}

function firstNumber(node: GraphNode, fieldId: string): number | null {
  for (const v of node.props[fieldId] ?? []) if (v.t === "num") return v.v;
  return null;
}

/** The first asset a node's `media` embeds, its cover: null when it embeds none. */
export function coverOf(node: GraphNode): string | null {
  for (const text of strings(node, GALLERY_IDS.mediaField)) {
    const first = assetEmbedsOf(text)[0];
    if (first !== undefined) return first.path;
  }
  return null;
}

/** The cover's aspect ratio (height / width), when the visual records its size. */
export function aspectOf(node: GraphNode): number | null {
  const w = firstNumber(node, GALLERY_IDS.widthField);
  const h = firstNumber(node, GALLERY_IDS.heightField);
  return w !== null && h !== null && w > 0 && h > 0 ? h / w : null;
}

export function promptOf(node: GraphNode): string {
  return strings(node, GALLERY_IDS.promptField)[0] ?? "";
}

export function negativeOf(node: GraphNode): string {
  return strings(node, GALLERY_IDS.negativeField)[0] ?? "";
}

export function sourceUrlOf(node: GraphNode): string | null {
  return strings(node, GALLERY_IDS.sourceField)[0] ?? null;
}

export interface StyleEntry {
  readonly id: string;
  readonly text: string;
  /** Its facet's id, or null for a style no facet holds. */
  readonly facet: string | null;
  readonly prompt: string;
  readonly negative: string;
  /** What it looks like, in plain words; empty when it says nothing. */
  readonly description: string;
  /** The styles it is made with (its `styles`), as ids the library knows. */
  readonly madeWith: readonly string[];
  /** Works that show it. */
  readonly seenIn: readonly string[];
  /** How to make it, one value per tool, each led by the tool's name. */
  readonly howTo: readonly string[];
}

export interface FacetEntry {
  readonly id: string;
  readonly text: string;
  /** Its styles, in outline order. */
  readonly styles: readonly string[];
}

export interface Library {
  /** Every visual, in outline order. */
  readonly visuals: readonly GraphNode[];
  readonly styles: ReadonlyMap<string, StyleEntry>;
  /** Every facet that holds a style, in outline order: the composer's order too. */
  readonly facets: readonly FacetEntry[];
  /** Each visual's styles, as ids the library knows. */
  readonly stylesOf: ReadonlyMap<string, readonly string[]>;
}

/** The id under which styles no facet holds are grouped. */
export const UNFILED = "";

/**
 * Read the library from the node set. Outline order is a walk from the
 * roots (nodes no node holds as a child), in the order given, then children
 * in their order, so facets and styles keep the places a person gave them.
 */
export function libraryOf(nodes: Iterable<GraphNode>): Library {
  const byId = new Map<string, GraphNode>();
  const held = new Set<string>();
  for (const node of nodes) {
    byId.set(node.id, node);
    for (const child of node.children) held.add(child);
  }
  const visuals: GraphNode[] = [];
  const styles = new Map<string, StyleEntry>();
  const styleNodes: GraphNode[] = [];
  const facets: { id: string; text: string; styles: string[] }[] = [];
  const facetById = new Map<string, { id: string; text: string; styles: string[] }>();
  const seen = new Set<string>();
  const walk = (start: GraphNode): void => {
    const stack: Array<[GraphNode, string | null]> = [[start, null]];
    while (stack.length > 0) {
      const top = stack.pop();
      if (top === undefined) break;
      const [node, facet] = top;
      if (seen.has(node.id)) continue;
      seen.add(node.id);
      let here = facet;
      if (isTagged(node, GALLERY_IDS.facetTag)) {
        here = node.id;
        if (!facetById.has(node.id)) {
          const entry = { id: node.id, text: node.text, styles: [] };
          facetById.set(node.id, entry);
          facets.push(entry);
        }
      }
      if (isTagged(node, GALLERY_IDS.styleTag)) {
        styles.set(node.id, {
          id: node.id,
          text: node.text,
          facet: here,
          // A style with no template composes as its name.
          prompt: promptOf(node) === "" ? node.text.trim() : promptOf(node),
          negative: negativeOf(node),
          description: strings(node, GALLERY_IDS.descriptionField)[0] ?? "",
          madeWith: [],
          seenIn: strings(node, GALLERY_IDS.seenInField),
          howTo: strings(node, GALLERY_IDS.howToField),
        });
        styleNodes.push(node);
        if (here !== null) facetById.get(here)?.styles.push(node.id);
      }
      if (isTagged(node, GALLERY_IDS.visualTag)) visuals.push(node);
      for (let i = node.children.length - 1; i >= 0; i--) {
        const childId = node.children[i];
        const child = childId === undefined ? undefined : byId.get(childId);
        if (child !== undefined) stack.push([child, here]);
      }
    }
  };
  for (const node of byId.values()) if (!held.has(node.id)) walk(node);
  // A cycle has no root: walk what is left so nothing tagged goes missing.
  for (const node of byId.values()) walk(node);
  // What a style is made with is known once every style is.
  for (const node of styleNodes) {
    const entry = styles.get(node.id);
    const madeWith = refs(node, GALLERY_IDS.madeWithField).filter(
      (id) => id !== node.id && styles.has(id),
    );
    if (entry !== undefined && madeWith.length > 0) styles.set(node.id, { ...entry, madeWith });
  }
  const stylesOf = new Map<string, readonly string[]>();
  for (const visual of visuals) {
    stylesOf.set(
      visual.id,
      refs(visual, GALLERY_IDS.stylesField).filter((id) => styles.has(id)),
    );
  }
  return { visuals, styles, facets: facets.filter((f) => f.styles.length > 0), stylesOf };
}

/** Which styles are chosen, per facet: OR within a facet, AND across facets. */
export type FacetSelection = ReadonlyMap<string, ReadonlySet<string>>;

function facetKey(library: Library, styleId: string): string {
  return library.styles.get(styleId)?.facet ?? UNFILED;
}

function matchesText(visual: GraphNode, needle: string): boolean {
  if (needle === "") return true;
  return (
    visual.text.toLowerCase().includes(needle) || promptOf(visual).toLowerCase().includes(needle)
  );
}

/** The active facets whose choice `visualId` shows none of. */
function failingFacets(library: Library, visualId: string, selection: FacetSelection): string[] {
  const own = library.stylesOf.get(visualId) ?? [];
  const failing: string[] = [];
  for (const [facet, chosen] of selection) {
    if (chosen.size === 0) continue;
    if (!own.some((id) => chosen.has(id) && facetKey(library, id) === facet)) failing.push(facet);
  }
  return failing;
}

/** The visuals that match the selection and the text, in library order. */
export function filterVisuals(
  library: Library,
  selection: FacetSelection,
  text: string,
): readonly GraphNode[] {
  const needle = text.trim().toLowerCase();
  return library.visuals.filter(
    (v) => matchesText(v, needle) && failingFacets(library, v.id, selection).length === 0,
  );
}

/**
 * Each style's count, as faceted search counts it: a value's count is over
 * the visuals that match every *other* facet's choice and the text, so
 * choosing within a facet never zeroes its siblings (disjunctive faceting).
 */
export function facetCounts(
  library: Library,
  selection: FacetSelection,
  text: string,
): ReadonlyMap<string, number> {
  const needle = text.trim().toLowerCase();
  const counts = new Map<string, number>();
  for (const visual of library.visuals) {
    if (!matchesText(visual, needle)) continue;
    const failing = failingFacets(library, visual.id, selection);
    if (failing.length > 1) continue;
    for (const id of library.stylesOf.get(visual.id) ?? []) {
      // A visual that fails one facet still counts toward that facet's values.
      if (failing.length === 1 && failing[0] !== facetKey(library, id)) continue;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  return counts;
}

/** The styles of `selection` in composer order: facet order, then each facet's own order. */
export function orderedStyles(
  library: Library,
  chosen: ReadonlySet<string>,
): readonly StyleEntry[] {
  const ordered: StyleEntry[] = [];
  for (const facet of library.facets)
    for (const id of facet.styles) {
      const style = library.styles.get(id);
      if (style !== undefined && chosen.has(id)) ordered.push(style);
    }
  for (const id of chosen) {
    const style = library.styles.get(id);
    if (style !== undefined && style.facet === null) ordered.push(style);
  }
  return ordered;
}

/** A source's search page for `query`: every `{query}` replaced by the encoded query. */
export function searchUrlOf(template: string, query: string): string {
  const encoded = encodeURIComponent(query.trim());
  return template.replaceAll("{query}", () => encoded);
}

export function creditOf(node: GraphNode): string {
  return strings(node, GALLERY_IDS.creditField)[0] ?? "";
}

/** An image source as the sources panel offers it. */
export interface ImageSource {
  readonly id: string;
  readonly text: string;
  /** Its search page, `{query}` standing for the query; empty when it names none. */
  readonly searchUrl: string;
  /** Its kind: `link` sources are opened, the others searched through `ext.gallery.search`. */
  readonly kind: "link" | "api";
}

/** Every node tagged image source, in the order given: what the sources panel lists. */
export function imageSourcesOf(nodes: Iterable<GraphNode>): readonly ImageSource[] {
  const sources: ImageSource[] = [];
  for (const node of nodes) {
    if (!isTagged(node, GALLERY_IDS.sourceTag)) continue;
    const kind = refs(node, GALLERY_IDS.sourceKindField)[0] ?? GALLERY_IDS.kindLink;
    sources.push({
      id: node.id,
      text: node.text,
      searchUrl: strings(node, GALLERY_IDS.searchUrlField)[0] ?? "",
      kind: kind === GALLERY_IDS.kindLink ? "link" : "api",
    });
  }
  return sources;
}
