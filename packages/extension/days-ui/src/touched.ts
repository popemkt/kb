/**
 * What a period made or edited (DESIGN-UI.md → Days): the nodes whose
 * created or updated instant falls within a day, week or year in the
 * page's zone, without schema or scaffolding.
 */
import { DAYS_IDS, dayKeyAt, isDayKey, weekKey, yearKey } from "@kb/days";
import { SYSTEM_IDS, typeRefsOf, type NodeLike } from "@kb/model";

/** The most "made or edited" rows a period's page lists. */
const MOST_TOUCHED = 30;

export type Stamped = NodeLike & { readonly createdAt?: string; readonly updatedAt?: string };

export function keyOf(node: NodeLike | undefined): string | null {
  const value = node?.props[DAYS_IDS.keyField]?.[0];
  return value?.t === "str" ? value.v : null;
}

/** The key of the period of `key`'s kind that `day` falls in: the day, its ISO week, or its year. */
function periodOf(day: string, key: string): string {
  if (isDayKey(key)) return day;
  return /^\d{4}$/.test(key) ? yearKey(day) : weekKey(day);
}

/** Whether `iso` (an instant kb wrote) falls within the period `key` in `zone`. */
function within(iso: string | undefined, key: string, zone: string): boolean {
  if (iso === undefined) return false;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return false;
  const day = dayKeyAt(ms, zone);
  return day !== null && periodOf(day, key) === key;
}

/** Schema and scaffolding a day did not make: `sys.*`, tags, fields and their options, period nodes. */
function scaffoldIds(nodes: ReadonlyMap<string, NodeLike>): ReadonlySet<string> {
  const out = new Set<string>();
  for (const node of nodes.values()) {
    const types = typeRefsOf(node);
    const schema = types.includes(SYSTEM_IDS.tag) || types.includes(SYSTEM_IDS.field);
    if (node.id.startsWith("sys.") || schema || keyOf(node) !== null) out.add(node.id);
    if (schema || node.id.startsWith("sys.")) for (const child of node.children) out.add(child);
  }
  return out;
}

/** The nodes made or edited within the period `key` (a day, an ISO week, a year), newest first. */
export function touchedIn(
  nodes: ReadonlyMap<string, Stamped>,
  key: string,
  zone: string,
): readonly string[] {
  const scaffold = scaffoldIds(nodes);
  return [...nodes.values()]
    .filter(
      (node) =>
        !scaffold.has(node.id) &&
        (within(node.createdAt, key, zone) || within(node.updatedAt, key, zone)),
    )
    .toSorted((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""))
    .slice(0, MOST_TOUCHED)
    .map((node) => node.id);
}
