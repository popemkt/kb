/**
 * A node's display text (DESIGN.md → Display text): the one projection every
 * surface that shows a node's words reads. It has one source and two
 * readings.
 *
 * - The source is the node's title (`nodeTitleOf`): its text, or the title
 *   its tag builds from its fields. It still holds its markup.
 * - The rich reading is that source drawn through the inline grammar, a
 *   reference as a pill (`@kb/ui-sdk`'s `InlineMarkdown`). A page draws it
 *   where it has room for a line of text: a row, the page title.
 * - The plain reading is the source as words with no markup
 *   ({@link plainWords}, {@link nodeName}). A page shows it where only a
 *   string fits: a breadcrumb, a tab, a list, a picker, a label, a tooltip,
 *   a toast.
 *
 * Both readings name a reference the same way, by {@link refName}. So a
 * pill and the words beside it never disagree about what a reference says.
 * Text written out of kb names a reference in one of three forms
 * ({@link RefForm}), which the markup-keeping reading ({@link markupWords})
 * and the plain one take.
 */
import { inlineSpanSource, parseInlineSource, type InlineSeg, type InlineSpan } from "./inline.ts";
import type { NodeId } from "./model.ts";
import type { NodeLike } from "./node-like.ts";
import { nodeTitleOf } from "./tag-behaviour.ts";
import type { ViewHostOf } from "./view-node.ts";

/** What a reading needs of a node: its text and its props, by id. */
type DisplayLookup = (id: NodeId) => Pick<NodeLike, "text" | "props"> | undefined;

/** What a node with no words is called. */
const UNTITLED = "Untitled";

/**
 * What a reference reads as: its label, when it has one; else the name of
 * the node it names; else, that node gone, its id. A target with no words
 * reads as {@link UNTITLED}, and a bare reference that comes back to itself
 * through its target's text reads as its id.
 */
export function refName(
  id: NodeId,
  label: string | undefined,
  nodeOf: DisplayLookup,
  seen: ReadonlySet<NodeId> = new Set(),
): string {
  const written = label?.trim() ?? "";
  if (written !== "") return written;
  const target = nodeOf(id);
  if (target === undefined || seen.has(id)) return id;
  return wordsOf(nodeTitleOf(id, target, nodeOf), nodeOf, new Set([...seen, id])) || UNTITLED;
}

/**
 * How text written out of kb names a reference: its words (`label`), a
 * `[[words]]` link another outliner reads (`link`), or its token as stored
 * (`id`), which kb reads back to the same node.
 */
export type RefForm = "label" | "link" | "id";

/** What a link cannot hold: a `[[words]]` with one of these in it is not one token. */
const NOT_IN_LINK = /[[\]|]/;

/** The reference `span` written in `form`. */
function refWritten(
  span: InlineSpan & { readonly seg: { readonly t: "ref" } },
  form: RefForm,
  nodeOf: DisplayLookup,
  seen: ReadonlySet<NodeId>,
): string {
  if (form === "id") return span.open;
  const words = refName(span.seg.id, span.seg.label, nodeOf, seen);
  return form === "link" && !NOT_IN_LINK.test(words) ? `[[${words}]]` : words;
}

const isRef = (span: InlineSpan): span is InlineSpan & { readonly seg: { readonly t: "ref" } } =>
  span.seg.t === "ref";

function segmentWords(seg: InlineSeg, nodeOf: DisplayLookup, seen: ReadonlySet<NodeId>): string {
  switch (seg.t) {
    case "text":
    case "bold":
    case "italic":
    case "codeSpan":
      return seg.v;
    case "link":
      return seg.label;
    case "media":
      return seg.alt;
    case "ref":
      return refName(seg.id, seg.label, nodeOf, seen);
    default: {
      const unhandled: never = seg;
      throw new Error(`unhandled inline segment: ${JSON.stringify(unhandled)}`);
    }
  }
}

function wordsOf(
  text: string,
  nodeOf: DisplayLookup,
  seen: ReadonlySet<NodeId>,
  form: RefForm = "label",
): string {
  return parseInlineSource(text)
    .map((span) =>
      isRef(span) && form !== "label"
        ? refWritten(span, form, nodeOf, seen)
        : segmentWords(span.seg, nodeOf, seen),
    )
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * `text` as plain words: what a person reads in it, with no markup. Text
 * and emphasis read as their words, code as its content, a link as its
 * label, media as its alt text, and a reference as {@link refName} says.
 * Runs of whitespace, line breaks included, read as one space. Text
 * written out of kb may name its references in another `form`.
 */
export function plainWords(text: string, nodeOf: DisplayLookup, form: RefForm = "label"): string {
  return wordsOf(text, nodeOf, new Set(), form);
}

/**
 * `text` as markdown written out of kb: its markup as written, and each
 * reference in `form` (its words by default), so a docs template and a
 * markdown export read a reference as every reading does. A token the
 * grammar does not read as a reference (inside code or emphasis) stays as
 * written.
 */
export function markupWords(text: string, nodeOf: DisplayLookup, form: RefForm = "label"): string {
  return parseInlineSource(text)
    .map((span) =>
      isRef(span) ? refWritten(span, form, nodeOf, new Set()) : inlineSpanSource(span),
    )
    .join("");
}

/**
 * A node's name: its display text's plain reading, or "" when it has no
 * words (a surface says {@link UNTITLED} or its id, as fits it). A surface
 * that can read who names a view node passes `hostOf`, so a view node is
 * named with what it is a view of (`nodeTitleOf`).
 */
export function nodeName(id: NodeId, nodeOf: DisplayLookup, hostOf?: ViewHostOf): string {
  const node = nodeOf(id);
  return node === undefined ? "" : plainWords(nodeTitleOf(id, node, nodeOf, hostOf), nodeOf);
}
