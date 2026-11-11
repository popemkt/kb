/**
 * What a period key may be (DESIGN.md → Days): the key `sys.f.days.key`
 * belongs on a node that is a day, a week or a year (tagged `#day`, `#week`
 * or `#year`, or a tag that extends one), in that period's form: a calendar
 * date `2026-11-10`, an ISO week of its year `2026-W46`, a year `2026`.
 * With one node per key (`unique-key.ts`), every key a store holds names
 * one real period. A person may re-key a day to another free date: that is
 * a correction, not a corruption, so the field is managed but not locked
 * (`sys.f.managedBy`; DESIGN.md → Data-plane freedom).
 *
 * The key is judged as stored, never trimmed: a blank or padded key is a
 * malformed one, and only a node with no key value at all holds none. A
 * node that stays a period keeps a key: its key can be changed, not taken
 * off, so a day is never left that the family cannot find by its date. The
 * guard judges a node whose key or tags a write changes; a write that
 * changes what a tag extends (or deletes a tag that extended one) can make
 * a holder stop being its period, so it judges every holder, over the graph
 * as the commit leaves it. An ordinary commit costs nothing.
 */
import { Effect } from "effect";
import type { ActionGuard } from "@kb/contracts";
import {
  SYSTEM_IDS,
  tagChains,
  typeRefsOf,
  type KindsLookup,
  type NodeLike,
  type NodeWrite,
  type PropValue,
} from "@kb/model";
import { DAYS_IDS } from "./ids.ts";
import { isDayKey, weekKey } from "./period.ts";

const WEEK_KEY = /^(\d{4})-W(\d{2})$/;
const YEAR_KEY = /^\d{4}$/;

/** Whether `key` names an ISO week: its year's week 1 to that year's last. */
function isWeekKey(key: string): boolean {
  const match = WEEK_KEY.exec(key);
  if (match === null) return false;
  const week = Number(match[2]);
  // 28 December is always in its year's last ISO week.
  const last = Number(weekKey(`${match[1]}-12-28`).slice(-2));
  return week >= 1 && week <= last;
}

/** Each period, its base tag, and the form its key takes. */
const PERIODS = [
  { tag: DAYS_IDS.dayTag, name: "day", form: "a date, YYYY-MM-DD", fits: isDayKey },
  { tag: DAYS_IDS.weekTag, name: "week", form: "an ISO week, YYYY-Www", fits: isWeekKey },
  {
    tag: DAYS_IDS.yearTag,
    name: "year",
    form: "a year, YYYY",
    fits: (key: string) => YEAR_KEY.test(key),
  },
] as const;

/** The periods `node` is, through its tags and what they extend. */
export function periodsOf(
  node: Pick<NodeLike, "props">,
  nodeOf: KindsLookup,
): (typeof PERIODS)[number][] {
  const chains = tagChains(nodeOf);
  const reached = new Set(typeRefsOf(node).flatMap((tag) => chains.ancestors(tag)));
  return PERIODS.filter(({ tag }) => reached.has(tag));
}

/** The key values `node` holds, as stored; none when it holds no key. */
export function keyValues(node: Pick<NodeLike, "props"> | undefined): readonly PropValue[] {
  return node?.props[DAYS_IDS.keyField] ?? [];
}

const same = (a: readonly unknown[], b: readonly unknown[]) =>
  JSON.stringify(a) === JSON.stringify(b);

const extendsOf = (node: NodeLike | undefined) => node?.props[SYSTEM_IDS.extendsField] ?? [];

/** Whether `write` changes what a tag extends: the ancestry every holder is judged through. */
function movesAncestry({ before, after }: NodeWrite): boolean {
  return !same(extendsOf(before), extendsOf(after));
}

/** Whether `write` leaves a node whose key or tags are not what they were. */
function changesKeyOrTags({ before, after }: NodeWrite): boolean {
  if (after === undefined) return false;
  if (before === undefined) return true;
  return !same(keyValues(before), keyValues(after)) || !same(typeRefsOf(before), typeRefsOf(after));
}

/** Why `node`'s key is not a period of it, or null when it is one or there is none. */
function keyRefusal(node: NodeLike, nodeOf: KindsLookup): string | null {
  const values = keyValues(node);
  if (values.length === 0) return null;
  const shown = values.map((value) => `“${String(value.v)}”`).join(", ");
  const periods = periodsOf(node, nodeOf);
  const [period] = periods;
  if (period === undefined || periods.length > 1)
    return `“${node.text}” holds the period ${shown}, but only a node that is one #day, #week or #year has a period`;
  const fits = values.every((value) => value.t === "str" && period.fits(value.v));
  return fits
    ? null
    : `${shown} is not a ${period.name}: a ${period.name}'s period is ${period.form}`;
}

/**
 * Why `write` may not take the key off its node: the node stays a day, week
 * or year, and a period without its key is no longer found as one (the
 * family would make a second node for that date). Taking the tag off is
 * the way out: it takes the key with it (`untag.ts`).
 */
function removalRefusal({ before, after }: NodeWrite, nodeOf: KindsLookup): string | null {
  if (after === undefined || keyValues(before).length === 0 || keyValues(after).length > 0)
    return null;
  const [period] = periodsOf(after, nodeOf);
  if (period === undefined) return null;
  return `“${after.text}” is a ${period.name}, so its period can be changed but not removed: take #${period.name} off to make it an ordinary node`;
}

const leftBy = (writes: readonly NodeWrite[]) =>
  writes.flatMap(({ after }) => (after === undefined ? [] : [after]));

/**
 * The nodes `writes` could leave with a key that is no period of theirs:
 * those whose key or tags they change, or, when they move what a tag
 * extends, every node after the commit (`held` is every node before it).
 */
function judgedBy(writes: readonly NodeWrite[], held: Iterable<NodeLike>): NodeLike[] {
  if (!writes.some(movesAncestry)) return leftBy(writes.filter(changesKeyOrTags));
  const written = new Set(writes.map(({ before, after }) => (after ?? before)?.id));
  return [...leftBy(writes), ...[...held].filter((node) => !written.has(node.id))];
}

/**
 * Why `writes` may not land: a node they leave holding a period key that
 * is not a day, week or year, or a key not in its period's form, read over
 * the graph as it would be after the commit (`nodeOf`); null when every
 * key they touch is one. `held` is every node before the commit, which a
 * write that moves a tag's ancestry has judged again.
 */
export function periodKeyRefusal(
  writes: readonly NodeWrite[],
  nodeOf: KindsLookup,
  held: Iterable<NodeLike> = [],
): string | null {
  for (const write of writes) {
    const refusal = removalRefusal(write, nodeOf);
    if (refusal !== null) return refusal;
  }
  for (const node of judgedBy(writes, held)) {
    const refusal = keyRefusal(node, nodeOf);
    if (refusal !== null) return refusal;
  }
  return null;
}

export const periodKeyGuard: Omit<ActionGuard, "match"> = {
  commit: (call) =>
    Effect.sync(() => {
      const written = new Map(
        call.writes.map(({ before, after }) => [(after ?? before)?.id, after]),
      );
      const nodeOf = (id: string): NodeLike | undefined =>
        written.has(id) ? written.get(id) : call.nodeOf(id);
      const refusal = periodKeyRefusal(call.writes, nodeOf, call.ctx.nodes);
      return refusal === null
        ? { decision: "allow" as const }
        : { decision: "deny" as const, rule: "days.period-key", message: refusal };
    }),
};
