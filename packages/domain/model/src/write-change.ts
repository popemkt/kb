/**
 * What a write changes, as a person reads it (DESIGN.md → Plugin data
 * migrations, "A plan is read node by node, and exactly"): the one reading
 * of a {@link NodeWrite} every surface shows, so the CLI, MCP and the page
 * never build a second diff.
 *
 * A write is its node's name and its parts: the text, each field whose
 * values differ, and the children. A part's before and after are the exact
 * text the store holds (a reference named by its target), and
 * {@link textDiff} with {@link visibleText} draws them so that a change that
 * is only whitespace still shows.
 */
import { nodeName, refName } from "./display-text.ts";
import { valueSource } from "./field-value.ts";
import type { KbNode, NodeId, PropValue } from "./model.ts";
import { changedFields, type NodeWrite } from "./tx.ts";

/** What a write does to its node, in the order a reading groups them. */
export const WRITE_KINDS = ["change", "create", "delete"] as const;
type WriteKind = (typeof WRITE_KINDS)[number];

/** One part of a node a write changes: its label, and its value before and after (null where none). */
interface WritePart {
  /** `text`, `children`, or the id of the field. */
  readonly part: string;
  readonly label: string;
  readonly before: string | null;
  readonly after: string | null;
}

export interface WriteChange {
  readonly id: NodeId;
  /** The node's name as it will read, or as it read for a delete; "" when it has no words. */
  readonly name: string;
  readonly kind: WriteKind;
  readonly parts: readonly WritePart[];
}

type Lookup = (id: NodeId) => KbNode | undefined;

/** What separates the values of a field with several, and the names of children. */
const LIST = ", ";

/** A value as words: a reference by its target's name, anything else as the text it is written as. */
function valueWords(value: PropValue, nodeOf: Lookup): string {
  return value.t === "ref" ? refName(value.v, undefined, nodeOf) : valueSource(value);
}

function listOf(words: readonly string[]): string | null {
  return words.length === 0 ? null : words.join(LIST);
}

/**
 * What `write` changes, its names read in `nodeOf` (the graph it applies to)
 * with the written node as it will be. Its timestamps are bookkeeping, not
 * parts.
 */
export function writeChange(write: NodeWrite, nodeOf: Lookup): WriteChange {
  const { before, after } = write;
  const node = after ?? before;
  if (node === undefined) throw new Error("a write names its node before or after");
  const lookup: Lookup = (id) => (id === node.id ? node : nodeOf(id));
  const kind: WriteKind =
    before === undefined ? "create" : after === undefined ? "delete" : "change";
  const text: WritePart[] =
    before?.text === after?.text
      ? []
      : [{ part: "text", label: "Text", before: before?.text ?? null, after: after?.text ?? null }];
  const fields = changedFields(before, after).map(
    (field): WritePart => ({
      part: field,
      label: nodeName(field, lookup) || field,
      before: listOf((before?.props[field] ?? []).map((value) => valueWords(value, lookup))),
      after: listOf((after?.props[field] ?? []).map((value) => valueWords(value, lookup))),
    }),
  );
  const childNames = (held: KbNode | undefined) =>
    listOf((held?.children ?? []).map((child) => refName(child, undefined, lookup)));
  const children: WritePart[] =
    (before?.children ?? []).join("\n") === (after?.children ?? []).join("\n")
      ? []
      : [
          {
            part: "children",
            label: "Children",
            before: childNames(before),
            after: childNames(after),
          },
        ];
  return {
    id: node.id,
    name: nodeName(node.id, lookup),
    kind,
    parts: [...text, ...fields, ...children],
  };
}

const GRAPHEMES = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** `text`'s characters as a reader sees them, so a cut never splits one (an emoji, an accent). */
export function graphemes(text: string): string[] {
  return Array.from(GRAPHEMES.segment(text), (part) => part.segment);
}

/** A run of a part's text: kept on both sides, or only before (removed) or after (added). */
export interface DiffSpan {
  readonly kind: "same" | "removed" | "added";
  readonly text: string;
}

/** How many characters of shared text {@link textDiff} keeps on each side of a change. */
const CONTEXT = 32;

/**
 * `before` against `after`: the text they share at the start and the end,
 * and what is removed and added between. A shared run longer than `context`
 * keeps only the `context` characters nearest the change, after or before
 * an `…`. Null on a side is no value: everything on the other side is the
 * change.
 */
export function textDiff(
  before: string | null,
  after: string | null,
  context: number = CONTEXT,
): DiffSpan[] {
  const a = graphemes(before ?? "");
  const b = graphemes(after ?? "");
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let end = 0;
  while (
    end < a.length - start &&
    end < b.length - start &&
    a[a.length - 1 - end] === b[b.length - 1 - end]
  )
    end += 1;
  const head = a.slice(0, start);
  const tail = a.slice(a.length - end);
  const spans: DiffSpan[] = [
    {
      kind: "same",
      text: head.length > context ? `…${head.slice(-context).join("")}` : head.join(""),
    },
    { kind: "removed", text: a.slice(start, a.length - end).join("") },
    { kind: "added", text: b.slice(start, b.length - end).join("") },
    {
      kind: "same",
      text: tail.length > context ? `${tail.slice(0, context).join("")}…` : tail.join(""),
    },
  ];
  return spans.filter((span) => span.text !== "");
}

/** The marks {@link visibleText} draws whitespace with. */
const WHITESPACE_MARKS = { "\n": "⏎", "\t": "⇥", "\r": "␍", " ": "·" } as const;

const MARKS: Readonly<Record<string, string>> = WHITESPACE_MARKS;

/**
 * `text` with its whitespace drawn: a line break as `⏎`, a tab as `⇥`, a
 * carriage return as `␍`, and, when `spaces` says so (in what a change
 * removes or adds, where a space would otherwise be invisible), a space as
 * `·`.
 */
export function visibleText(text: string, spaces = false): string {
  return text.replace(spaces ? /[\n\t\r ]/gu : /[\n\t\r]/gu, (char) => MARKS[char] ?? char);
}
