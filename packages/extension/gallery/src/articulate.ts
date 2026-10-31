/**
 * Articulating an image: the readings the composer's workflows share to
 * turn a fuzzy idea into named styles (docs/research/2026-10-30-visual-composer.md).
 *
 * - The **axes** an idea is broken into: subject, mood, lighting, camera
 *   and lens, palette, era or style, artists, composition, motion. Each axis
 *   reads the library's facets by name, so a person's own facets join the
 *   axis that names them, and a facet no axis names is an axis of its own.
 * - The **reflection**: what the model is asked to break an idea into, and
 *   how its answer is read back into chips, each a style the library knows
 *   or a new word for an axis's facet.
 * - **Either/or**: two styles of one facet the look has nothing in yet,
 *   since a person recognises faster than they name.
 * - **Kinship**: visuals ranked by the styles they share with one, and a
 *   look's variations along one axis (a chosen style swapped for a sibling).
 *
 * Pure over the library: no model, no store. The model is asked through the
 * page's completion service, and every reading here has a hand-driven use
 * when there is none.
 */
import type { Library, StyleEntry } from "./library.ts";

/** An axis an idea is broken into, and the facets it reads, by name. */
interface AxisSpec {
  readonly id: string;
  readonly label: string;
  /** Facet names, lower-case, that belong to this axis. */
  readonly facets: readonly string[];
}

/** The axes, in the order an art director walks them; the subject has no facet. */
const AXIS_SPECS: readonly AxisSpec[] = [
  { id: "subject", label: "Subject", facets: [] },
  { id: "mood", label: "Mood", facets: ["mood"] },
  { id: "lighting", label: "Lighting", facets: ["lighting"] },
  { id: "camera", label: "Camera and lens", facets: ["lens", "film stock"] },
  { id: "palette", label: "Palette", facets: ["palette"] },
  { id: "style", label: "Era or style", facets: ["era", "art movement", "medium", "texture"] },
  { id: "artists", label: "Artists", facets: ["artist"] },
  { id: "composition", label: "Composition", facets: ["shot size", "camera angle"] },
  { id: "motion", label: "Motion", facets: ["camera motion"] },
];

/** An axis as the library has it: the facets it reads, by id. */
export interface Axis {
  readonly id: string;
  readonly label: string;
  readonly facets: readonly string[];
}

/** The axes over `library`: the named axes, then one per facet no axis names. */
export function axesOf(library: Library): readonly Axis[] {
  const claimed = new Set<string>();
  const axes: Axis[] = AXIS_SPECS.map((spec) => {
    const facets = library.facets
      .filter((f) => spec.facets.includes(f.text.trim().toLowerCase()))
      .map((f) => f.id);
    for (const id of facets) claimed.add(id);
    return { id: spec.id, label: spec.label, facets };
  });
  for (const facet of library.facets) {
    if (!claimed.has(facet.id)) axes.push({ id: facet.id, label: facet.text, facets: [facet.id] });
  }
  return axes;
}

/** The styles an axis offers, in the library's order. */
export function axisStyles(library: Library, axis: Axis): readonly StyleEntry[] {
  return axis.facets.flatMap((facetId) =>
    (library.facets.find((f) => f.id === facetId)?.styles ?? []).flatMap((id) => {
      const style = library.styles.get(id);
      return style === undefined ? [] : [style];
    }),
  );
}

/** How many known names per axis the model is shown, so the request stays bounded. */
const NAMES_PER_AXIS = 60;

/**
 * The completion that reflects an idea: the person's words (and, through
 * the service, any pictures) in, a brief and terms per axis out, as JSON.
 * The model is shown the names the library already has per axis, so it
 * prefers the person's own vocabulary.
 */
export function reflectInput(
  words: string,
  library: Library,
  pictures: number,
): { readonly system: string; readonly message: string } {
  const axes = axesOf(library);
  const known = axes
    .map((axis) => {
      const names = axisStyles(library, axis)
        .slice(0, NAMES_PER_AXIS)
        .map((s) => s.text);
      return `- ${axis.id} (${axis.label})${names.length === 0 ? "" : `: ${names.join("; ")}`}`;
    })
    .join("\n");
  const system = [
    "You are an art director helping a person put the image in their head into words.",
    "Break what they give you into these axes, each with up to five short terms",
    "(a term is a style a prompt can name: 'golden hour', 'low angle', 'Kodak Portra 400').",
    "Prefer the known terms listed for an axis; add new ones only where none fits.",
    "Leave an axis out when nothing suggests it.",
    "",
    known,
    "",
    "Answer with JSON alone, no prose and no code fence:",
    '{"description": "<one or two plain sentences: the subject and what it should feel like>",',
    ' "axes": {"<axis id>": ["<term>", ...], ...}}',
  ].join("\n");
  const said = words.trim() === "" ? "(no words)" : words.trim();
  const message =
    pictures === 0
      ? said
      : `${said}\n\n(${pictures} reference ${pictures === 1 ? "picture is" : "pictures are"} attached: read the look from them too.)`;
  return { system, message };
}

/** A model's reflection, read back. */
export interface Reflection {
  readonly description: string;
  /** Terms per axis id, as the model named them. */
  readonly axes: ReadonlyMap<string, readonly string[]>;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** The reply read as a reflection; null when it holds no JSON object of that shape. */
export function parseReflection(reply: string): Reflection | null {
  const start = reply.indexOf("{");
  const end = reply.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(reply.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  const description = typeof parsed["description"] === "string" ? parsed["description"] : "";
  const axes = new Map<string, readonly string[]>();
  const given = parsed["axes"];
  if (isRecord(given)) {
    for (const [axis, terms] of Object.entries(given)) {
      if (!Array.isArray(terms)) continue;
      const kept = terms.filter((t): t is string => typeof t === "string" && t.trim() !== "");
      if (kept.length > 0)
        axes.set(
          axis,
          kept.map((t) => t.trim()),
        );
    }
  }
  return { description, axes };
}

/** A candidate for an axis: a style the library has, or a new word for it. */
export interface Chip {
  readonly text: string;
  /** The style it names, null for a word the library does not have yet. */
  readonly style: string | null;
  /** The facet a new word would be filed under: the axis's first. */
  readonly facet: string | null;
}

/** A reflection's terms for `axis`, each matched to a style of the axis by name where one is. */
export function chipsFor(library: Library, axis: Axis, terms: readonly string[]): readonly Chip[] {
  const byName = new Map(axisStyles(library, axis).map((s) => [s.text.toLowerCase(), s.id]));
  // A term the library files under another axis still names that style.
  const anywhere = new Map([...library.styles.values()].map((s) => [s.text.toLowerCase(), s.id]));
  const seen = new Set<string>();
  const chips: Chip[] = [];
  for (const term of terms) {
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const style = byName.get(key) ?? anywhere.get(key) ?? null;
    chips.push({ text: term, style, facet: axis.facets[0] ?? null });
  }
  return chips;
}

/**
 * Either/or cards: for each axis the look has no style in yet, two of its
 * styles to choose between, taken far apart in the facet's order and moved
 * on by `round`, so asking again offers another pair.
 */
export function eitherOrs(
  library: Library,
  chosen: ReadonlySet<string>,
  round: number,
  limit = 3,
): ReadonlyArray<{
  readonly axis: Axis;
  readonly pair: readonly [StyleEntry, StyleEntry];
}> {
  const cards: Array<{ axis: Axis; pair: readonly [StyleEntry, StyleEntry] }> = [];
  for (const axis of axesOf(library)) {
    const styles = axisStyles(library, axis);
    if (styles.length < 2 || styles.some((s) => chosen.has(s.id))) continue;
    const half = Math.floor(styles.length / 2);
    const first = styles[round % half];
    const second = styles[half + (round % (styles.length - half))];
    if (first !== undefined && second !== undefined) cards.push({ axis, pair: [first, second] });
    if (cards.length === limit) break;
  }
  return cards;
}

/**
 * The visuals most like `visualId`, by the styles they share with it
 * (Jaccard), best first; ties keep the library's order. Image similarity is
 * a recorded gap: shared styles stand in.
 */
export function moreLike(library: Library, visualId: string, limit = 24): readonly string[] {
  const mine = new Set(library.stylesOf.get(visualId) ?? []);
  if (mine.size === 0) return [];
  const scored: Array<{ id: string; score: number }> = [];
  for (const visual of library.visuals) {
    if (visual.id === visualId) continue;
    const theirs = library.stylesOf.get(visual.id) ?? [];
    const shared = theirs.filter((id) => mine.has(id)).length;
    if (shared === 0) continue;
    scored.push({ id: visual.id, score: shared / (mine.size + theirs.length - shared) });
  }
  return scored
    .toSorted((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.id);
}

/**
 * The visuals nearest a look's styles, best first: each scored by the
 * styles it shows that the look has, less those it shows that the person
 * said no to (`against`), so a reaction moves what is offered next. Ties
 * keep the library's order; a visual that shares nothing is left out
 * unless the look has no styles yet, when the library's first are offered.
 */
export function nearest(
  library: Library,
  styles: readonly string[],
  against: ReadonlySet<string> = new Set(),
  limit = 60,
): readonly string[] {
  const wanted = new Set(styles);
  if (wanted.size === 0) return library.visuals.slice(0, limit).map((v) => v.id);
  const scored: Array<{ id: string; score: number }> = [];
  for (const visual of library.visuals) {
    const own = library.stylesOf.get(visual.id) ?? [];
    const shared = own.filter((s) => wanted.has(s)).length;
    if (shared === 0) continue;
    scored.push({ id: visual.id, score: shared - own.filter((s) => against.has(s)).length });
  }
  return scored
    .toSorted((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.id);
}

/**
 * A look's variations along one axis: each chosen style of a facet swapped
 * for each sibling in that facet, as the styles the variation would have.
 */
export function variationsOf(
  library: Library,
  styles: readonly string[],
  limitPerStyle = 4,
): ReadonlyArray<{
  readonly from: StyleEntry;
  readonly to: StyleEntry;
  readonly styles: readonly string[];
}> {
  const out: Array<{ from: StyleEntry; to: StyleEntry; styles: readonly string[] }> = [];
  for (const id of styles) {
    const from = library.styles.get(id);
    const facet = library.facets.find((f) => f.id === from?.facet);
    if (from === undefined || facet === undefined) continue;
    const siblings = facet.styles.filter((s) => s !== id && !styles.includes(s));
    for (const siblingId of siblings.slice(0, limitPerStyle)) {
      const to = library.styles.get(siblingId);
      if (to !== undefined)
        out.push({ from, to, styles: styles.map((s) => (s === id ? siblingId : s)) });
    }
  }
  return out;
}

/**
 * An example picture per style: the first visual that shows it, so every
 * chip can be drawn with what it names (the library as a visual
 * dictionary). One pass over the library, not one per chip.
 */
export function examplesOf(library: Library): ReadonlyMap<string, string> {
  const examples = new Map<string, string>();
  for (const visual of library.visuals) {
    for (const style of library.stylesOf.get(visual.id) ?? []) {
      if (!examples.has(style)) examples.set(style, visual.id);
    }
  }
  return examples;
}
