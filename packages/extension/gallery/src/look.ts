/**
 * The look: what every workflow of the composer makes (DESIGN-UI.md → The
 * gallery; docs/research/2026-10-30-visual-composer.md §3). A look is a
 * node tagged `#look`: its description (the brief, and the composer's
 * subject), its styles, its negative, its palette, the node it is for, and
 * its pins, child nodes whose text is the note and whose `reference` is the
 * visual. Prompts per model are read from it by the composer's one rule,
 * never stored.
 *
 * Pure over the node set: the page reads a saved look into a draft, edits
 * the draft, and saving is the plan of writes from what is saved to what
 * the draft says (`lookWrites`).
 */
import type { PropValue } from "@kb/model";
import { COMPOSE_TARGETS, composePrompt, type ComposeTarget } from "./compose.ts";
import { GALLERY_IDS } from "./ids.ts";
import {
  coverOf,
  creditOf,
  isTagged,
  orderedStyles,
  sourceUrlOf,
  type GraphNode,
  type Library,
} from "./library.ts";

/** A visual pinned to a look, with what it is there for. */
export interface Pin {
  /** The pin's node, once saved. */
  readonly id: string | null;
  readonly visual: string;
  readonly note: string;
}

export interface LookDraft {
  /** The saved look's node, null until it is saved. */
  readonly id: string | null;
  readonly name: string;
  readonly description: string;
  /** Style ids, in the order they were chosen; composed in facet order. */
  readonly styles: readonly string[];
  readonly negative: string;
  /** Swatches, `#rrggbb`. */
  readonly palette: readonly string[];
  readonly pins: readonly Pin[];
  /** The node the look art-directs. */
  readonly forNode: string | null;
}

export const EMPTY_LOOK: LookDraft = {
  id: null,
  name: "",
  description: "",
  styles: [],
  negative: "",
  palette: [],
  pins: [],
  forNode: null,
};

const strings = (node: GraphNode, field: string): readonly string[] =>
  (node.props[field] ?? []).flatMap((v) => (v.t === "str" ? [v.v] : []));
const refs = (node: GraphNode, field: string): readonly string[] =>
  (node.props[field] ?? []).flatMap((v) => (v.t === "ref" ? [v.v] : []));

/** Every look in the node set, in the order given. */
export function looksOf(nodes: Iterable<GraphNode>): readonly GraphNode[] {
  return [...nodes].filter((node) => isTagged(node, GALLERY_IDS.lookTag));
}

/** A saved look read as a draft; `get` reads its pins. */
export function lookOf(look: GraphNode, get: (id: string) => GraphNode | undefined): LookDraft {
  const pins: Pin[] = [];
  for (const childId of look.children) {
    const child = get(childId);
    const visual = child === undefined ? undefined : refs(child, GALLERY_IDS.referenceField)[0];
    if (child !== undefined && visual !== undefined) {
      pins.push({ id: child.id, visual, note: child.text });
    }
  }
  return {
    id: look.id,
    name: look.text,
    description: strings(look, GALLERY_IDS.descriptionField)[0] ?? "",
    styles: refs(look, GALLERY_IDS.stylesField),
    negative: strings(look, GALLERY_IDS.negativeField)[0] ?? "",
    palette: strings(look, GALLERY_IDS.paletteField),
    pins,
    forNode: refs(look, GALLERY_IDS.forField)[0] ?? null,
  };
}

/** What a look is called when it has no name: its brief's first words. */
export function nameOf(draft: LookDraft): string {
  if (draft.name.trim() !== "") return draft.name.trim();
  // The brief's first words, without the punctuation they were cut at.
  const words = draft.description
    .trim()
    .split(/\s+/)
    .slice(0, 6)
    .join(" ")
    .replace(/[^\p{L}\p{N})\]]+$/u, "");
  return words === "" ? "Untitled look" : words;
}

/** The look's prompt for each model family, composed from its brief and styles. */
export function promptsOf(
  draft: LookDraft,
  library: Library,
): ReadonlyArray<{
  readonly target: ComposeTarget;
  readonly label: string;
  readonly positive: string;
  readonly negative: string;
}> {
  const styles = orderedStyles(library, new Set(draft.styles));
  return COMPOSE_TARGETS.map(({ id, label }) => ({
    target: id,
    label,
    ...composePrompt(draft.description, draft.negative, styles, id),
  }));
}

/** A field's values as the write takes them. */
interface PropWrite {
  readonly field: string;
  readonly value: PropValue;
}

const str = (field: string, v: string): PropWrite => ({ field, value: { t: "str", v } });
const ref = (field: string, v: string): PropWrite => ({ field, value: { t: "ref", v } });

function lookProps(draft: LookDraft): readonly PropWrite[] {
  return [
    ...(draft.description.trim() === ""
      ? []
      : [str(GALLERY_IDS.descriptionField, draft.description.trim())]),
    ...draft.styles.map((id) => ref(GALLERY_IDS.stylesField, id)),
    ...(draft.negative.trim() === ""
      ? []
      : [str(GALLERY_IDS.negativeField, draft.negative.trim())]),
    ...draft.palette.map((hex) => str(GALLERY_IDS.paletteField, hex)),
    ...(draft.forNode === null ? [] : [ref(GALLERY_IDS.forField, draft.forNode)]),
  ];
}

/** The fields a look writes whole: each is unset and set again when it changes. */
const LOOK_FIELDS = [
  GALLERY_IDS.descriptionField,
  GALLERY_IDS.stylesField,
  GALLERY_IDS.negativeField,
  GALLERY_IDS.paletteField,
  GALLERY_IDS.forField,
] as const;

/** One core write: what `node.add`, `node.update` and `node.delete` take. */
export type LookWrite =
  | {
      readonly id: "node.add";
      readonly input: {
        readonly text: string;
        readonly parent?: string;
        readonly tags?: readonly string[];
        readonly props: readonly PropWrite[];
      };
      /** The pin this adds, when it adds one: the page records the id it gets back. */
      readonly pin?: number;
    }
  | {
      readonly id: "node.update";
      readonly input: {
        readonly id: string;
        readonly text?: string;
        readonly setProps?: readonly PropWrite[];
        readonly unsetProps?: ReadonlyArray<{ readonly field: string }>;
      };
    }
  | { readonly id: "node.delete"; readonly input: { readonly id: string } };

const sameProps = (a: readonly PropWrite[], b: readonly PropWrite[]): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

/**
 * The writes that make what is saved (`saved`, null for a new look) say
 * what `draft` says. A new look is one write, under `parent`: the page
 * reads back its id and asks again with the look saved and no pins, which
 * leaves the pins to add.
 */
export function lookWrites(
  draft: LookDraft,
  saved: LookDraft | null,
  parent: string | null,
): readonly LookWrite[] {
  const lookId = draft.id;
  if (saved === null || lookId === null) {
    return [
      {
        id: "node.add",
        input: {
          text: nameOf(draft),
          ...(parent === null ? {} : { parent }),
          tags: [GALLERY_IDS.lookTag],
          props: lookProps(draft),
        },
      },
    ];
  }
  const writes: LookWrite[] = [];
  const props = lookProps(draft);
  const textChanged = nameOf(draft) !== nameOf(saved);
  if (textChanged || !sameProps(props, lookProps(saved))) {
    writes.push({
      id: "node.update",
      input: {
        id: lookId,
        ...(textChanged ? { text: nameOf(draft) } : {}),
        unsetProps: LOOK_FIELDS.map((field) => ({ field })),
        setProps: props,
      },
    });
  }
  const kept = new Set(draft.pins.flatMap((pin) => (pin.id === null ? [] : [pin.id])));
  for (const pin of saved.pins) {
    if (pin.id !== null && !kept.has(pin.id))
      writes.push({ id: "node.delete", input: { id: pin.id } });
  }
  const before = new Map(saved.pins.map((pin) => [pin.id, pin]));
  draft.pins.forEach((pin, index) => {
    if (pin.id === null) {
      writes.push({
        id: "node.add",
        pin: index,
        input: {
          text: pin.note,
          parent: lookId,
          props: [{ field: GALLERY_IDS.referenceField, value: { t: "ref", v: pin.visual } }],
        },
      });
    } else if (before.get(pin.id)?.note !== pin.note) {
      writes.push({ id: "node.update", input: { id: pin.id, text: pin.note } });
    }
  });
  return writes;
}

/** A look as a brief for a person: Markdown, with its prompts, palette and references. */
export function briefOf(
  draft: LookDraft,
  library: Library,
  get: (id: string) => GraphNode | undefined,
): string {
  const lines = [`# ${nameOf(draft)}`, ""];
  if (draft.description.trim() !== "") lines.push(draft.description.trim(), "");
  const forNode = draft.forNode === null ? undefined : get(draft.forNode);
  if (forNode !== undefined) lines.push(`For: ${forNode.text}`, "");
  const chosen = orderedStyles(library, new Set(draft.styles));
  if (chosen.length > 0) {
    lines.push("## Styles", "");
    for (const facet of library.facets) {
      const here = chosen.filter((s) => s.facet === facet.id).map((s) => s.text);
      if (here.length > 0) lines.push(`- **${facet.text}**: ${here.join(", ")}`);
    }
    const loose = chosen.filter((s) => s.facet === null).map((s) => s.text);
    if (loose.length > 0) lines.push(`- ${loose.join(", ")}`);
    lines.push("");
  }
  if (draft.negative.trim() !== "") lines.push(`Avoid: ${draft.negative.trim()}`, "");
  if (draft.palette.length > 0) lines.push("## Palette", "", draft.palette.join(" "), "");
  lines.push(...promptLines(draft, library), ...referenceLines(draft, get));
  return lines.join("\n");
}

/** A brief's prompts section: the look's prompt for each model family. */
function promptLines(draft: LookDraft, library: Library): readonly string[] {
  const lines = ["## Prompts", ""];
  for (const p of promptsOf(draft, library)) {
    lines.push(`**${p.label}**`, "", "```", p.positive, "```", "");
    if (p.negative !== "") lines.push("Negative:", "", "```", p.negative, "```", "");
  }
  return lines;
}

/** A brief's references section: each pin's visual, its note, picture, source and credit. */
export function referenceLines(
  draft: LookDraft,
  get: (id: string) => GraphNode | undefined,
): readonly string[] {
  if (draft.pins.length === 0) return [];
  const lines = ["## References", ""];
  for (const pin of draft.pins) {
    const visual = get(pin.visual);
    if (visual === undefined) continue;
    const cover = coverOf(visual);
    const source = sourceUrlOf(visual);
    const credit = creditOf(visual);
    const note = pin.note.trim() === "" ? "" : ` — ${pin.note.trim()}`;
    lines.push(`- ${visual.text}${note}`);
    if (cover !== null) lines.push(`  ![${visual.text}](${cover})`);
    if (source !== null) lines.push(`  Source: ${source}${credit === "" ? "" : ` (${credit})`}`);
  }
  lines.push("");
  return lines;
}
