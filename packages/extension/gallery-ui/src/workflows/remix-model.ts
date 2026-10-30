/**
 * Remix, pure over the library: two or three sources (visuals and saved
 * looks) laid out axis by axis, the look made from the axes taken from each,
 * and one source's variations along one axis, grouped by the style swapped.
 */
import {
  axesOf,
  variationsOf,
  type Axis,
  type Library,
  type LookDraft,
  type StyleEntry,
} from "@kb/gallery";

/** What a remix mixes: a visual's styles or a saved look's. */
export interface RemixSource {
  readonly id: string;
  readonly kind: "visual" | "look";
  readonly label: string;
  readonly styles: readonly string[];
}

/** One axis across the sources: each source's styles on it, in the sources' order. */
export interface RemixRow {
  readonly axis: Axis;
  readonly cells: ReadonlyArray<readonly StyleEntry[]>;
}

/** Which source each axis is taken from, by its index among the sources; an axis absent takes none. */
export type RemixChoices = ReadonlyMap<string, number>;

/** The rows of the table: every axis some source has a style on, in the axes' order. */
export function remixRows(library: Library, sources: readonly RemixSource[]): readonly RemixRow[] {
  return axesOf(library).flatMap((axis) => {
    const cells = sources.map((source) =>
      source.styles.flatMap((id) => {
        const style = library.styles.get(id);
        return style !== undefined && style.facet !== null && axis.facets.includes(style.facet)
          ? [style]
          : [];
      }),
    );
    return cells.some((cell) => cell.length > 0) ? [{ axis, cells }] : [];
  });
}

/** A first choice per axis: the first source with a style on it. */
export function defaultChoices(rows: readonly RemixRow[]): RemixChoices {
  const choices = new Map<string, number>();
  for (const row of rows) {
    const index = row.cells.findIndex((cell) => cell.length > 0);
    if (index !== -1) choices.set(row.axis.id, index);
  }
  return choices;
}

/** "the lighting and the palette" from axis labels. */
function listOf(labels: readonly string[]): string {
  const the = labels.map((l) => `the ${l.toLowerCase()}`);
  return the.length <= 1
    ? (the[0] ?? "")
    : `${the.slice(0, -1).join(", ")} and ${the[the.length - 1] ?? ""}`;
}

/**
 * The look the choices make: its styles the union of those taken, in the
 * axes' order, and its pins the visual sources, each noting the axes taken
 * from it. A visual already pinned keeps its pin's node; every other field
 * of the draft is kept.
 */
export function remixDraft(
  draft: LookDraft,
  sources: readonly RemixSource[],
  rows: readonly RemixRow[],
  choices: RemixChoices,
): LookDraft {
  const styles: string[] = [];
  const taken = new Map<number, string[]>();
  for (const row of rows) {
    const index = choices.get(row.axis.id);
    const cell = index === undefined ? undefined : row.cells[index];
    if (index === undefined || cell === undefined || cell.length === 0) continue;
    for (const style of cell) if (!styles.includes(style.id)) styles.push(style.id);
    taken.set(index, [...(taken.get(index) ?? []), row.axis.label]);
  }
  const pins = sources.flatMap((source, index) => {
    if (source.kind !== "visual") return [];
    const labels = taken.get(index) ?? [];
    const note = labels.length === 0 ? "" : `${listOf(labels)} from here`;
    const before = draft.pins.find((p) => p.visual === source.id);
    return [{ id: before?.id ?? null, visual: source.id, note }];
  });
  return { ...draft, styles, pins };
}

/** One chosen style's variations: the sibling it is swapped for, and the styles that makes. */
export interface VariationGroup {
  readonly from: StyleEntry;
  readonly options: ReadonlyArray<{ readonly to: StyleEntry; readonly styles: readonly string[] }>;
}

/** `variationsOf` grouped by the style each swaps, in the order the styles are chosen. */
export function variationGroups(
  library: Library,
  styles: readonly string[],
): readonly VariationGroup[] {
  const groups = new Map<
    string,
    { from: StyleEntry; options: Array<{ to: StyleEntry; styles: readonly string[] }> }
  >();
  for (const { from, to, styles: next } of variationsOf(library, styles)) {
    const group = groups.get(from.id) ?? { from, options: [] };
    group.options.push({ to, styles: next });
    groups.set(from.id, group);
  }
  return [...groups.values()];
}
