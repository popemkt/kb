/**
 * Today for the store, and captures into it (DESIGN.md → Days). A day is a
 * calendar date, so "today" needs a zone. A process that serves a store may
 * run anywhere, a server in UTC for a person seven hours east say, so the
 * family's `time zone` setting names the store's. Without one (or with a
 * name that is not a zone) a process falls back to its own. The page asks
 * its own day for what a person does in it (`@kb/days-ui`), and only a
 * write that names no place, from any surface, uses the store's.
 *
 * The family's `captures` setting says whether a node written with no
 * chosen place lands in today (the default) or at the top level, so a
 * store kept in a repository, where agents write gaps and todos, can keep
 * days without dating every write.
 */
import { Effect } from "effect";
import type { CapturePlanner } from "@kb/contracts";
import { clockSampler, refValuesOf, strValueOf, type KbNode } from "@kb/model";
import { DAYS_IDS } from "./ids.ts";
import { dayKeyAt } from "./period.ts";
import { planToday } from "./today-plan.ts";

/** Whether the family's `captures` setting sends a node written with no place to today; unset, it does. */
export function capturesToday(family: KbNode | undefined): boolean {
  const [choice] = refValuesOf(family, DAYS_IDS.capturesField);
  return choice !== DAYS_IDS.capturesTop;
}

/** The family's node among `nodes`, which holds its settings. */
function familyIn(nodes: readonly KbNode[]): KbNode | undefined {
  return nodes.find((node) => node.id === DAYS_IDS.family);
}

/**
 * Today's key for the store that holds `nodes`, at the clock's instant: in
 * the zone its `time zone` setting names, or this process's zone when it
 * names none that is one.
 */
export const storeToday = Effect.fn("ext.days.storeToday")(function* (nodes: readonly KbNode[]) {
  const sample = (yield* clockSampler)();
  const zone = strValueOf(familyIn(nodes), DAYS_IDS.timeZoneField);
  return (
    (zone === null ? null : dayKeyAt(sample.nowMs, zone)) ??
    dayKeyAt(sample.nowMs, sample.timeZone) ??
    ""
  );
});

/**
 * Days' answer to the registry's capture target: today's node in the
 * store's zone, with whatever is missing above it to make, or the top level
 * when the `captures` setting says so.
 */
export const captureToday: CapturePlanner = Effect.fn("ext.days.capture")(function* (
  nodes: readonly KbNode[],
) {
  if (!capturesToday(familyIn(nodes))) return { parent: null, upserts: [] };
  const write = yield* planToday(nodes, yield* storeToday(nodes));
  return { parent: write.id, upserts: write.upserts };
});
