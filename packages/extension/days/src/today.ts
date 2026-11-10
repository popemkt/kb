/**
 * `ext.days.today` (DESIGN.md → Days): a day's node, made, with whatever is
 * missing above it, in one transaction. The day is the caller's; without
 * one it is the local day of the process that runs the action.
 */
import { Effect } from "effect";
import { z } from "zod";
import { KbCtx, type ExtensionAction, type KbStore } from "@kb/contracts";
import {
  clockSampler,
  currentIso,
  domainError,
  freshId,
  IndexedNodes,
  present,
  SYSTEM_IDS,
  type DomainError,
  type KbNode,
  type NodeId,
} from "@kb/model";
import { persistPlannedEffect, planNodeAdd, type PropEntry } from "@kb/operations";
import { DAYS_IDS } from "./ids.ts";
import { dayKeyAt, isDayKey } from "./period.ts";
import { planDay } from "./plan.ts";

const todayInput = z.object({
  day: z
    .string()
    .optional()
    .describe(
      "the calendar date, YYYY-MM-DD; the local day of the process that runs it when omitted",
    ),
});
const todayOutput = z.object({
  id: z.string().describe("the day's node"),
  made: z
    .array(z.string())
    .describe("the nodes this call made, parent first; empty when the day existed"),
});

/** At most the journal root, a year, a week and the day. */
const MOST_MADE = 4;

/** What one attempt plans: the nodes to write, the day's node, and what it made. */
interface TodayWrite {
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
const planToday = Effect.fn("ext.days.today.plan")(function* (
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

/**
 * One node per key holds across every caller because the write lands only
 * on the state it was planned from (`persistPlannedEffect`, the store's
 * conditional commit): a second caller that planned the same day before the
 * first committed is planned again, finds the day, and writes nothing. The
 * unique-key guard is what refuses a hand-keyed duplicate.
 */
const todayEffect = Effect.fn("ext.days.today")(function* (
  input: z.infer<typeof todayInput>,
): Effect.fn.Return<z.infer<typeof todayOutput>, DomainError, KbCtx | KbStore> {
  const sample = (yield* clockSampler)();
  const day = input.day ?? dayKeyAt(sample.nowMs, sample.timeZone) ?? "";
  if (!isDayKey(day))
    return yield* domainError("invalid_input", `not a calendar date (YYYY-MM-DD): ${day}`);
  const ctx = yield* KbCtx;
  const write = yield* persistPlannedEffect(ctx, (nodes) => planToday(nodes, day));
  const { id, made } = present(write, "a day plan always answers");
  return { id, made: [...made] };
});

export const TODAY_ACTION: ExtensionAction = {
  id: "today",
  title: "Open a day",
  description:
    "A day's node (today's when day is omitted), made the first time it is asked for, in one transaction with whatever is missing above it: the journal root, the year, the ISO week. A day node is found by its period key, never its text or place.",
  mode: { kind: "write" },
  inputSchema: todayInput,
  outputSchema: todayOutput,
  effect: todayEffect,
};
