/**
 * What a write changes, as a person reads it (DESIGN.md → Plugin data
 * migrations, "A plan is read node by node, and exactly"): the one reading
 * of a {@link NodeWrite} every surface shows, so the CLI, MCP and the page
 * never build a second diff.
 *
 * A write is its node's name and its parts: the text, each field whose
 * values differ, and the children. A part's before and after are the values
 * the store holds, typed and by id (a reference and a child carry their
 * target's name beside it), so nothing two values differ by is lost.
 * {@link partDiff} draws a part as removed and added runs, naming a value
 * that reads like another by its id or its type, and {@link visibleText}
 * makes whitespace show.
 */
import { nodeName, refName } from "./display-text.ts";
import { valueSource } from "./field-value.ts";
import type { KbNode, NodeId, PropValue } from "./model.ts";
import { changedFields, type NodeWrite } from "./tx.ts";

/** What a write does to its node, in the order a reading groups them. */
export const WRITE_KINDS = ["change", "create", "delete"] as const;
type WriteKind = (typeof WRITE_KINDS)[number];

/** One value a part holds: as the store holds it, and for a reference the name of the node it names. */
interface WriteValue {
  readonly value: PropValue;
  readonly name?: string;
}

/** One part of a node a write changes: its label, and its values before and after (none where it has none). */
interface WritePart {
  /** `text`, `children`, or the id of the field. */
  readonly part: string;
  readonly label: string;
  readonly before: readonly WriteValue[];
  readonly after: readonly WriteValue[];
}

export interface WriteChange {
  readonly id: NodeId;
  /** The node's name as it will read, or as it read for a delete; "" when it has no words. */
  readonly name: string;
  readonly kind: WriteKind;
  readonly parts: readonly WritePart[];
}

type Lookup = (id: NodeId) => KbNode | undefined;

/** A node's text as a part's values: one text, or none where the node is not. */
const textOf = (held: KbNode | undefined): WriteValue[] =>
  held === undefined ? [] : [{ value: { t: "str", v: held.text } }];

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
  const valued = (value: PropValue): WriteValue =>
    value.t === "ref" ? { value, name: refName(value.v, undefined, lookup) } : { value };
  const childrenOf = (held: KbNode | undefined) =>
    (held?.children ?? []).map((child) => valued({ t: "ref", v: child }));
  const kind: WriteKind =
    before === undefined ? "create" : after === undefined ? "delete" : "change";
  const text: WritePart[] =
    before?.text === after?.text
      ? []
      : [{ part: "text", label: "Text", before: textOf(before), after: textOf(after) }];
  const fields = changedFields(before, after).map(
    (field): WritePart => ({
      part: field,
      label: nodeName(field, lookup) || field,
      before: (before?.props[field] ?? []).map(valued),
      after: (after?.props[field] ?? []).map(valued),
    }),
  );
  const children: WritePart[] =
    (before?.children ?? []).join("\n") === (after?.children ?? []).join("\n")
      ? []
      : [
          {
            part: "children",
            label: "Children",
            before: childrenOf(before),
            after: childrenOf(after),
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
 * an `…`.
 */
function textDiff(before: string, after: string, context: number): DiffSpan[] {
  const a = graphemes(before);
  const b = graphemes(after);
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

/** What a value of each kind is called, where a value must be told from one that reads the same. */
const KIND_NAMES: Readonly<Record<PropValue["t"], string>> = {
  str: "text",
  date: "date",
  num: "number",
  bool: "checkbox",
  ref: "reference",
};

/** A value's identity: its kind and what it holds, which two values differ by when they differ. */
const identityOf = ({ value }: WriteValue) => `${value.t}:${String(value.v)}`;

/** A value's words: a reference by its target's name, an empty text as `""`, anything else as written. */
function wordsOf({ value, name }: WriteValue): string {
  if (value.t === "ref") return name === undefined || name === "" ? value.v : name;
  const written = valueSource(value);
  return written === "" ? '""' : written;
}

/**
 * The words each value of `values` reads as: its own, and where two values
 * that are not the same read alike (two nodes named Alex, the number 3 and
 * the text "3"), each with what tells it apart: a reference its id, any
 * other value its kind.
 */
function namesOf(values: readonly WriteValue[]): Map<string, string> {
  const byWords = new Map<string, Map<string, WriteValue>>();
  for (const value of values) {
    const words = wordsOf(value);
    const same = byWords.get(words) ?? new Map<string, WriteValue>();
    same.set(identityOf(value), value);
    byWords.set(words, same);
  }
  const names = new Map<string, string>();
  for (const [words, same] of byWords)
    for (const [identity, held] of same)
      names.set(
        identity,
        same.size === 1
          ? words
          : `${words} (${held.value.t === "ref" ? held.value.v : KIND_NAMES[held.value.t]})`,
      );
  return names;
}

/** The longest list of positions `a` and `b` share in order, as pairs; past a size, only their common ends. */
function commonOrder(a: readonly string[], b: readonly string[]): [number, number][] {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let end = 0;
  while (
    end < a.length - start &&
    end < b.length - start &&
    a[a.length - 1 - end] === b[b.length - 1 - end]
  )
    end += 1;
  const pairs: [number, number][] = Array.from({ length: start }, (_, at) => [at, at]);
  const midA = a.slice(start, a.length - end);
  const midB = b.slice(start, b.length - end);
  // Past this, the middle is shown as all removed and all added rather than paying for its order.
  if (midA.length * midB.length <= 250_000) {
    // How long the common order of midA from i and midB from j is, row by row.
    const width = midB.length + 1;
    const table = new Int32Array((midA.length + 1) * width);
    const at = (i: number, j: number) => table[i * width + j] ?? 0;
    for (let i = midA.length - 1; i >= 0; i -= 1)
      for (let j = midB.length - 1; j >= 0; j -= 1)
        table[i * width + j] =
          midA[i] === midB[j] ? at(i + 1, j + 1) + 1 : Math.max(at(i + 1, j), at(i, j + 1));
    let i = 0;
    let j = 0;
    while (i < midA.length && j < midB.length) {
      if (midA[i] === midB[j]) {
        pairs.push([start + i, start + j]);
        i += 1;
        j += 1;
      } else if (at(i + 1, j) >= at(i, j + 1)) i += 1;
      else j += 1;
    }
  }
  for (let at = 0; at < end; at += 1) pairs.push([a.length - end + at, b.length - end + at]);
  return pairs;
}

/**
 * How `part` reads as a change: what it keeps, what it removes and what it
 * adds. One text on each side is diffed by character, its shared runs cut to
 * `context` around the change; anything else is diffed value by value, in
 * order, each value named so it cannot be mistaken for another
 * ({@link namesOf}), and the values joined by `, `.
 */
export function partDiff(part: WritePart, context: number = CONTEXT): DiffSpan[] {
  const [one] = part.before;
  const [other] = part.after;
  if (
    part.before.length === 1 &&
    part.after.length === 1 &&
    one !== undefined &&
    other !== undefined &&
    (one.value.t === "str" || one.value.t === "date") &&
    one.value.t === other.value.t
  )
    return textDiff(one.value.v, other.value.v, context);
  const names = namesOf([...part.before, ...part.after]);
  const a = part.before.map(identityOf);
  const b = part.after.map(identityOf);
  const runs: DiffSpan[] = [];
  const push = (kind: DiffSpan["kind"], identity: string) => {
    if (runs.length > 0) runs.push({ kind: "same", text: ", " });
    runs.push({ kind, text: names.get(identity) ?? identity });
  };
  let i = 0;
  let j = 0;
  for (const [ai, bj] of [...commonOrder(a, b), [a.length, b.length] as [number, number]]) {
    for (; i < ai; i += 1) push("removed", a[i] ?? "");
    for (; j < bj; j += 1) push("added", b[j] ?? "");
    if (ai < a.length) push("same", a[ai] ?? "");
    i = ai + 1;
    j = bj + 1;
  }
  return runs;
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
