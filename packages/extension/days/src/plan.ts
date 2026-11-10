/**
 * Finding and making a day's node (DESIGN.md → Days): a pure plan over the
 * graph, so the action that commits it, its tests and any host agree on
 * exactly which nodes one call makes. A period node is found by its key
 * alone; its text, its place and its other tags are the person's.
 */
import { refValuesOf, type NodeLike } from "@kb/model";
import { DAYS_IDS } from "./ids.ts";
import { dayTitle, isDayKey, weekKey, weekTitle, yearKey } from "./period.ts";

/** One node the plan makes, parent first. */
export interface NewPeriodNode {
  readonly id: string;
  readonly text: string;
  /** Its parent: a node already in the graph or one made earlier in the plan; null is the top level. */
  readonly parent: string | null;
  readonly tag: string | null;
  readonly key: string | null;
}

export interface DayPlan {
  /** The day's node, existing or made by the plan. */
  readonly day: string;
  /** What to make, parent first; empty when the day exists. */
  readonly make: readonly NewPeriodNode[];
  /** The journal root the plan made, which the family's `journal` setting must then name. */
  readonly journal: string | null;
}

export const JOURNAL_TEXT = "Daily notes";

/** The node holding `key`, if one does. */
export function periodNodeOf(nodes: Iterable<NodeLike>, key: string): string | null {
  for (const node of nodes) {
    const value = node.props[DAYS_IDS.keyField]?.[0];
    if (value?.t === "str" && value.v === key) return node.id;
  }
  return null;
}

/** The journal root the family's node names, if it names one that exists. */
export function journalOf(
  family: NodeLike | undefined,
  nodeOf: (id: string) => NodeLike | undefined,
): string | null {
  if (family === undefined) return null;
  const [root] = refValuesOf(family, DAYS_IDS.journalField);
  return root !== undefined && nodeOf(root) !== undefined ? root : null;
}

/**
 * The plan for `day`'s node. Its year goes under the journal root, its week
 * under its year, the day under its week; a period that exists anywhere is
 * reused where it is, so a week a person moved keeps its new days.
 */
export function planDay(
  nodes: ReadonlyMap<string, NodeLike>,
  day: string,
  mint: () => string,
): DayPlan {
  if (!isDayKey(day)) throw new RangeError(`not a calendar date (YYYY-MM-DD): ${day}`);
  const all = [...nodes.values()];
  const existing = periodNodeOf(all, day);
  if (existing !== null) return { day: existing, make: [], journal: null };
  const make: NewPeriodNode[] = [];
  const add = (node: Omit<NewPeriodNode, "id">): string => {
    const id = mint();
    make.push({ id, ...node });
    return id;
  };
  let journal: string | null = null;
  const root = () =>
    journalOf(nodes.get(DAYS_IDS.family), (id) => nodes.get(id)) ??
    (journal = add({ text: JOURNAL_TEXT, parent: null, tag: null, key: null }));
  const yearOf = periodNodeOf(all, yearKey(day));
  const weekOf = periodNodeOf(all, weekKey(day));
  const week =
    weekOf ??
    add({
      text: weekTitle(day),
      parent:
        yearOf ??
        add({ text: yearKey(day), parent: root(), tag: DAYS_IDS.yearTag, key: yearKey(day) }),
      tag: DAYS_IDS.weekTag,
      key: weekKey(day),
    });
  const id = add({ text: dayTitle(day), parent: week, tag: DAYS_IDS.dayTag, key: day });
  return { day: id, make, journal };
}
