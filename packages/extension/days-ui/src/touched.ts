/**
 * What a day made or edited (DESIGN-UI.md → Days): the nodes whose created
 * or updated instant falls on the day in the page's zone, without schema
 * or scaffolding.
 */
import { DAYS_IDS } from "@kb/days";
import { dayAt, parseDay, SYSTEM_IDS, typeRefsOf, type NodeLike } from "@kb/model";

/** The most "made or edited" rows a day page lists. */
const MOST_TOUCHED = 30;

export type Stamped = NodeLike & { readonly createdAt?: string; readonly updatedAt?: string };

export function keyOf(node: NodeLike | undefined): string | null {
  const value = node?.props[DAYS_IDS.keyField]?.[0];
  return value?.t === "str" ? value.v : null;
}

/** Whether `iso` (an instant kb wrote) falls on `day` in the page's zone. */
function onDay(iso: string | undefined, day: string, zone: string): boolean {
  if (iso === undefined) return false;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return false;
  const local = dayAt(ms, zone);
  const want = parseDay(day);
  return (
    local !== null &&
    want !== null &&
    local.year === want.year &&
    local.month === want.month &&
    local.day === want.day
  );
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

/** The nodes made or edited on `day`, newest first. */
export function touchedOn(
  nodes: ReadonlyMap<string, Stamped>,
  day: string,
  zone: string,
): readonly string[] {
  const scaffold = scaffoldIds(nodes);
  return [...nodes.values()]
    .filter(
      (node) =>
        !scaffold.has(node.id) &&
        (onDay(node.createdAt, day, zone) || onDay(node.updatedAt, day, zone)),
    )
    .toSorted((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""))
    .slice(0, MOST_TOUCHED)
    .map((node) => node.id);
}

/** A row's label: its text, or "Untitled" for an empty one. */
export function textOf(node: NodeLike | undefined): string {
  const text = node?.text ?? "";
  return text === "" ? "Untitled" : text;
}
