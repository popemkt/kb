/**
 * The picker engine: choosing nodes from a candidate set by typing.
 *
 * Every place kb asks "which node?" is this one gesture over a different
 * candidate set — a ref or options field value, a `[[` reference in text, a
 * tag or a field to add, a node to reference, an ontology's include/extends
 * lists, a node to place on a canvas. They differ only in where candidates
 * come from, whether a new one may be minted, and what a pick writes. So the
 * matching, the ranking, the create row and the keys are stated once, here
 * and in `use-picker.ts`, and the one list (`components/ui/picker-list`)
 * draws the result. A surface that needs a picker supplies candidates and a
 * write; it never ranks or handles an arrow key itself.
 *
 * Pure: no React runtime, no DOM.
 */
import type { ReactNode } from "react";
import { isNodeIdShaped, isSysPrefixed } from "@kb/model";

/** One node a picker may offer, as the picker sees it. */
export interface PickerCandidate {
  readonly id: string;
  /** What the row shows and what a query is matched against. */
  readonly label: string;
  /** Leading glyph drawn before the label. */
  readonly glyph?: ReactNode;
  /** Muted text after the label (e.g. "already extends"). */
  readonly note?: string;
  /** Shown, but not pickable. */
  readonly disabled?: boolean;
  /** Discoverable by label or an explicit system id search, without an empty-query row. */
  readonly queryOnly?: boolean;
}

/** A half-open `[from, to)` range of a label that the query matched. */
export type MatchRange = readonly [number, number];

/** The id of the row that mints a node from the query. Never a node id. */
export const CREATE_ROW_ID = "\u0000create";

export type PickerRow =
  | {
      readonly kind: "item";
      readonly id: string;
      readonly label: string;
      readonly glyph?: ReactNode;
      readonly note?: string;
      readonly disabled: boolean;
      /** Where the query landed in `label`, for highlighting. */
      readonly matches: readonly MatchRange[];
      /** Already a value of the field being picked for. */
      readonly selected: boolean;
    }
  | {
      readonly kind: "create";
      readonly id: typeof CREATE_ROW_ID;
      /** The name the new node gets: the query, trimmed. */
      readonly name: string;
    };

export interface PickerQuery {
  readonly query: string;
  /** Ids already picked; their rows are marked, and stay pickable (a toggle). */
  readonly selected?: ReadonlySet<string>;
  /**
   * Offer to mint a node named by the query, as the last row, when the query
   * names no candidate exactly.
   */
  readonly canCreate?: boolean;
  /** At most this many item rows (the create row is extra). */
  readonly limit?: number;
}

interface Match {
  /** Lower is better. */
  readonly score: number;
  readonly ranges: readonly MatchRange[];
}

const EXACT_LABEL_SCORE = -1;

/** Merge adjacent single-character ranges into runs. */
function runs(indices: readonly number[]): MatchRange[] {
  const out: Array<[number, number]> = [];
  for (const i of indices) {
    const last = out.at(-1);
    if (last !== undefined && last[1] === i) last[1] = i + 1;
    else out.push([i, i + 1]);
  }
  return out;
}

/** Where `q` occurs in `hay` as a subsequence, or null. */
function subsequence(hay: string, q: string): number[] | null {
  const at: number[] = [];
  let i = 0;
  for (let h = 0; h < hay.length && i < q.length; h++) {
    if (hay[h] === q[i]) {
      at.push(h);
      i += 1;
    }
  }
  return i === q.length ? at : null;
}

const isWordStart = (text: string, i: number): boolean =>
  i === 0 || /[\s\-_./:&]/.test(text[i - 1] ?? "");

/** Where `q`'s letters start words of `text`, in order (`bav` in "Binary assets & VCS"), or null. */
function initials(text: string, q: string): number[] | null {
  const at: number[] = [];
  let i = 0;
  for (let h = 0; h < text.length && i < q.length; h++) {
    if (text[h] === q[i] && isWordStart(text, h)) {
      at.push(h);
      i += 1;
    }
  }
  return i === q.length ? at : null;
}

/**
 * A subsequence reads as the query only when it is compact — its letters sit
 * close together (`dpi` in "Data pipeline"). Letters strewn across a long
 * label are noise: every long title "contains" every short query that way.
 */
function compact(at: readonly number[]): boolean {
  return (at.at(-1) ?? 0) - (at[0] ?? 0) + 1 <= at.length * 2 + 1;
}

/**
 * How well `query` matches a candidate, or null when it does not.
 *
 * Exact labels come first, then label prefixes, label substrings, id matches,
 * word initials, and compact subsequences. Only label matches carry ranges.
 */
export function matchCandidate(label: string, id: string, query: string): Match | null {
  const q = query.trim().toLowerCase();
  if (q === "") return { score: 0, ranges: [] };
  const text = label.toLowerCase();
  const at = text.indexOf(q);
  if (at >= 0) {
    const score = at === 0 ? 0 : 1;
    return {
      score: text.trim() === q ? EXACT_LABEL_SCORE : score,
      ranges: [[at, at + q.length]],
    };
  }
  if (matchesId(id, q)) return { score: 2, ranges: [] };
  if (q.length < 3) return null;
  const words = initials(text, q);
  if (words !== null) return { score: 3, ranges: runs(words) };
  const inLabel = subsequence(text, q);
  if (inLabel !== null && compact(inLabel)) {
    // Tighter first: the span the letters cover breaks ties among these.
    const span = (inLabel.at(-1) ?? 0) - (inLabel[0] ?? 0);
    return { score: 3 + span / 1000, ranges: runs(inLabel) };
  }
  return null;
}

function matchesId(id: string, query: string): boolean {
  // Uppercasing leaves the ULID shape intact and excludes the model's lowercase reserved ids.
  if (query.length < 2 || isNodeIdShaped(id.toUpperCase())) return false;
  const key = id.toLowerCase();
  if (isSysPrefixed(query)) return key.startsWith(query);
  return key.slice(key.lastIndexOf(".") + 1).includes(query);
}

/**
 * The rows a picker shows for a query: the matching candidates, best first,
 * then the create row when minting is allowed and nothing is named exactly.
 */
export function pickerRows(
  candidates: readonly PickerCandidate[],
  { query, selected, canCreate = false, limit = Number.POSITIVE_INFINITY }: PickerQuery,
): PickerRow[] {
  const name = query.trim();
  const explicitSystemSearch = isSysPrefixed(name.toLowerCase());
  const scored: Array<{ candidate: PickerCandidate; match: Match }> = [];
  for (const candidate of candidates) {
    const queryOnly = candidate.queryOnly === true;
    if (queryOnly && name === "") continue;
    const id = queryOnly && !explicitSystemSearch ? "" : candidate.id;
    const match = matchCandidate(candidate.label, id, name);
    if (match !== null) scored.push({ candidate, match });
  }
  // Stable, so candidates that match equally well keep the order their
  // source gave them (a label order, a command order, an option order).
  scored.sort((a, b) => a.match.score - b.match.score);
  const rows: PickerRow[] = scored.slice(0, limit).map(({ candidate, match }) => ({
    kind: "item",
    id: candidate.id,
    label: candidate.label,
    ...(candidate.glyph === undefined ? {} : { glyph: candidate.glyph }),
    ...(candidate.note === undefined ? {} : { note: candidate.note }),
    disabled: candidate.disabled === true,
    matches: match.ranges,
    selected: selected?.has(candidate.id) === true,
  }));
  const named = scored[0]?.match.score === EXACT_LABEL_SCORE;
  if (canCreate && name !== "" && !named) rows.push({ kind: "create", id: CREATE_ROW_ID, name });
  return rows;
}

/**
 * Split a label into the runs a query matched and the runs it did not, for
 * the list to highlight.
 */
export function labelRuns(
  label: string,
  matches: readonly MatchRange[],
): Array<{ text: string; matched: boolean; from: number }> {
  const out: Array<{ text: string; matched: boolean; from: number }> = [];
  let at = 0;
  for (const [from, to] of matches) {
    if (from > at) out.push({ text: label.slice(at, from), matched: false, from: at });
    out.push({ text: label.slice(from, to), matched: true, from });
    at = to;
  }
  if (at < label.length) out.push({ text: label.slice(at), matched: false, from: at });
  return out;
}

/** What orders a picker's candidates before a query does. */
export interface CandidateOrder {
  /** A declared order (a field's own options, in outline order): it wins outright. */
  readonly declared?: readonly string[];
  /** Picked lately, most recent first. */
  readonly recent?: readonly string[];
  /** How many times each candidate is already used where this picker writes. */
  readonly uses?: ReadonlyMap<string, number>;
  /** When no order is declared, offer unused candidates only through search. */
  readonly emptyQuery?: "recent-or-used";
}

/**
 * Candidates in the order a picker offers them with nothing typed: a declared
 * order when there is one — an option list is curated, and reordering a
 * status list by use would scramble it — otherwise the recently picked
 * first, then the most used, then the source's own order. A query then ranks
 * by match (`pickerRows`), stable, so this order breaks its ties.
 */
export function orderCandidates(
  candidates: readonly PickerCandidate[],
  { declared, recent = [], uses, emptyQuery }: CandidateOrder,
): PickerCandidate[] {
  if (declared !== undefined) {
    const place = new Map(declared.map((id, i) => [id, i]));
    const at = (c: PickerCandidate) => place.get(c.id) ?? Number.POSITIVE_INFINITY;
    return candidates.toSorted((a, b) => at(a) - at(b));
  }
  const lately = new Map(recent.map((id, i) => [id, i]));
  const rank = (c: PickerCandidate) => lately.get(c.id) ?? Number.POSITIVE_INFINITY;
  const used = (c: PickerCandidate) => uses?.get(c.id) ?? 0;
  const ordered = candidates.toSorted((a, b) => rank(a) - rank(b) || used(b) - used(a));
  if (emptyQuery !== "recent-or-used") return ordered;
  return ordered.map((c) => (lately.has(c.id) || used(c) > 0 ? c : { ...c, queryOnly: true }));
}
