/**
 * The write that gives a day its node (DESIGN.md → Days): the missing
 * periods above it, planned over a store's nodes, for `ext.days.today` and
 * for days' capture target to commit.
 */
import { Effect } from "effect";
import {
  currentIso,
  freshId,
  IndexedNodes,
  planNodeAdd,
  present,
  SYSTEM_IDS,
  type KbNode,
  type NodeId,
  type PropEntry,
} from "@kb/model";
import { DAYS_IDS } from "./ids.ts";
import { planDay } from "./plan.ts";

/** At most the journal root, a year, a week and the day. */
const MOST_MADE = 4;

/** What one attempt plans: the nodes to write, the day's node, and what it made. */
export interface TodayWrite {
  readonly upserts: readonly KbNode[];
  readonly deletes: readonly NodeId[];
  readonly id: NodeId;
  readonly made: readonly NodeId[];
}

/**
 * The write that gives `day` its node, planned over `nodes`: nothing when the
 * day has one, else the missing periods and, when the plan made the journal
 * root, the family's setting naming it.
 */
export const planToday = Effect.fn("ext.days.today.plan")(function* (
  nodes: readonly KbNode[],
  day: string,
): Effect.fn.Return<TodayWrite> {
  const graph = IndexedNodes.of(nodes);
  const ids: NodeId[] = [];
  for (let i = 0; i < MOST_MADE; i++) ids.push(yield* freshId);
  const plan = planDay(new Map(nodes.map((node) => [node.id, node])), day, () =>
    present(ids.shift(), "a period id was minted"),
  );
  if (plan.make.length === 0) return { upserts: [], deletes: [], id: plan.day, made: [] };
  const at = yield* currentIso;
  const written = new Set<NodeId>();
  for (const made of plan.make) {
    const props: PropEntry[] = [
      ...(made.tag === null
        ? []
        : [{ field: SYSTEM_IDS.typeField, value: { t: "ref" as const, v: made.tag } }]),
      ...(made.key === null
        ? []
        : [{ field: DAYS_IDS.keyField, value: { t: "str" as const, v: made.key } }]),
    ];
    const add = {
      text: made.text,
      props,
      ...(made.parent === null ? {} : { parent: made.parent }),
    };
    for (const id of planNodeAdd(graph, add, made.id, at).written) written.add(id);
  }
  const family = graph.get(DAYS_IDS.family);
  if (plan.journal !== null && family !== undefined) {
    const named: KbNode = {
      ...family,
      props: { ...family.props, [DAYS_IDS.journalField]: [{ t: "ref", v: plan.journal }] },
      updatedAt: at,
    };
    graph.put(named);
    written.add(named.id);
  }
  const upserts = [...written].map((id) =>
    present(graph.get(id), "a planned node is in the graph"),
  );
  return { upserts, deletes: [], id: plan.day, made: plan.make.map((made) => made.id) };
});
