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
 * The guard looks only at a write that leaves a node holding a key it did
 * not hold so, or tagged otherwise than before, so an ordinary commit costs
 * nothing.
 */
import { Effect } from "effect";
import type { ActionGuard } from "@kb/contracts";
import {
  strValueOf,
  tagChains,
  typeRefsOf,
  type KindsLookup,
  type NodeLike,
  type NodeWrite,
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
function periodsOf(node: NodeLike, nodeOf: KindsLookup): (typeof PERIODS)[number][] {
  const chains = tagChains(nodeOf);
  const reached = new Set(typeRefsOf(node).flatMap((tag) => chains.ancestors(tag)));
  return PERIODS.filter(({ tag }) => reached.has(tag));
}

/**
 * Why `writes` may not land: a node they leave holding a period key that
 * is not a day, week or year, or a key not in its period's form, read over
 * the graph as it would be after the commit (`nodeOf`); null when every
 * key they touch is one.
 */
export function periodKeyRefusal(writes: readonly NodeWrite[], nodeOf: KindsLookup): string | null {
  for (const { before, after } of writes) {
    if (after === undefined) continue;
    const key = strValueOf(after, DAYS_IDS.keyField);
    if (key === null) continue;
    const retagged =
      typeRefsOf(after).join() !== (before === undefined ? "" : typeRefsOf(before).join());
    if (key === strValueOf(before, DAYS_IDS.keyField) && !retagged) continue;
    const periods = periodsOf(after, nodeOf);
    const [period] = periods;
    if (period === undefined || periods.length > 1)
      return `“${after.text}” holds the period ${key}, but only a node that is one #day, #week or #year has a period`;
    if (!period.fits(key))
      return `${key} is not a ${period.name}: a ${period.name}'s period is ${period.form}`;
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
      const refusal = periodKeyRefusal(call.writes, nodeOf);
      return refusal === null
        ? { decision: "allow" as const }
        : { decision: "deny" as const, rule: "days.period-key", message: refusal };
    }),
};
