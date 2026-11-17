/**
 * One calendar's pass, planned: what the store wants Google to hold, against
 * what Google lists (docs/research/2026-11-02-kb-routines-gcal.md → Push
 * reconciles against Google). Pure apart from hashing: it reads no network
 * and writes nothing, so the host plans an edit's waiting writes with the
 * same function its pass sends with.
 */
import { DateTime, Effect, Result } from "effect";
import { addDays, formatDay, parseDay, type NodeLike } from "@kb/model";
import {
  endSeries,
  eventId,
  holds,
  owned,
  project,
  readRoutine,
  routineOccurrences,
  sentDigest,
  startDay,
  SyncError,
  type CalendarConfig,
  type EventFields,
  type EventTime,
  type RemoteEvent,
} from "@kb/routines";

/** What a write's status belongs to: an event's series, one of its instances, or a calendar. */
export type Target =
  | { readonly kind: "series"; readonly routine: string }
  | { readonly kind: "instance"; readonly routine: string; readonly day: string }
  | { readonly kind: "calendar"; readonly calendar: string };

/** One put: its fields, and where it goes, an id kb has or the instance a lookup finds. */
export interface Write {
  readonly target: Target;
  readonly fields: EventFields;
  readonly to:
    | { readonly kind: "id"; readonly id: string }
    | {
        readonly kind: "lookup";
        readonly series: string;
        readonly original: EventTime;
        readonly zone: string;
      };
}

/** One event's part of a pass: the writes it needs, in order, and the targets Google already holds. */
export interface EventPlan {
  readonly routine: string;
  readonly writes: readonly Write[];
  readonly held: readonly { readonly target: Target; readonly remote: RemoteEvent }[];
  /** Why the event cannot be sent at all, as its series' status; null when it can. */
  readonly invalid: SyncError | null;
}

/** A gone event's series to end: the event node its `kbNode` names, which keys its release. */
interface Ending extends Write {
  readonly routine: string;
  readonly to: { readonly kind: "id"; readonly id: string };
}

export interface CalendarPlan {
  readonly endings: readonly Ending[];
  readonly events: readonly EventPlan[];
}

const backlinkOf = (origin: string, id: string) => origin + "/node/" + encodeURIComponent(id);

/** The day before `now` in `zone`, which a series ends at. */
function yesterday(now: number, zone: string): string {
  const today = parseDay(DateTime.formatIsoDate(DateTime.makeZonedUnsafe(now, { timeZone: zone })));
  if (today === null) throw new SyncError({ status: 400, code: "invalid_rule" });
  return formatDay(addDays(today, -1));
}

/** One event against the list: its series, each day its facts hold, and each exception with none. */
const planEvent = Effect.fn("routines.reconcile.event")(function* (
  calendar: CalendarConfig,
  node: NodeLike,
  nodes: ReadonlyMap<string, NodeLike>,
  remote: {
    readonly byId: ReadonlyMap<string, RemoteEvent>;
    readonly list: readonly RemoteEvent[];
  },
  origin: string,
) {
  const series = yield* eventId(calendar.id, node.id, "series", 0);
  const read = yield* Effect.try({
    try: () => {
      const { routine } = readRoutine(node, calendar.zone);
      const facts = routineOccurrences(node, nodes);
      const oneOff = routine.rrule.trim() === "";
      const backlink = backlinkOf(origin, node.id);
      const parent = project(routine, backlink, 0, {
        kind: "parent",
        occurrence: oneOff ? (facts.get(routine.starts)?.occurrence ?? null) : null,
      });
      const days = new Map<string, EventFields>();
      if (!oneOff) {
        for (const [day, fact] of facts)
          days.set(
            day,
            project(routine, backlink, 0, {
              kind: "instance",
              on: day,
              occurrence: fact.occurrence,
            }),
          );
        // An exception of this series with no fact on its day goes back to the series' default.
        for (const event of remote.list)
          if (event.exception?.series === series) {
            const day = startDay(event.exception.original, routine.zone);
            if (!days.has(day))
              days.set(
                day,
                project(routine, backlink, 0, { kind: "instance", on: day, occurrence: null }),
              );
          }
      }
      return { routine, parent, days };
    },
    catch: (error) =>
      error instanceof SyncError ? error : new SyncError({ status: 400, code: "invalid_rule" }),
  }).pipe(Effect.result);
  if (Result.isFailure(read))
    return { routine: node.id, writes: [], held: [], invalid: read.failure } satisfies EventPlan;
  const { routine, parent, days } = read.success;
  const exceptions = new Map<string, RemoteEvent>();
  for (const event of remote.list)
    if (event.exception?.series === series)
      exceptions.set(startDay(event.exception.original, routine.zone), event);
  const writes: Write[] = [];
  const held: { target: Target; remote: RemoteEvent }[] = [];
  const consider = Effect.fnUntraced(function* (
    target: Target,
    fields: EventFields,
    listed: RemoteEvent | undefined,
    to: Write["to"],
  ) {
    if (listed !== undefined && holds(listed, fields, yield* sentDigest(fields)))
      held.push({ target, remote: listed });
    else writes.push({ target, fields, to });
  });
  const master = remote.byId.get(series);
  // An event at kb's id that is not kb's is a person's: it is left as it is.
  if (master !== undefined && !master.cancelled && !owned(master))
    return {
      routine: node.id,
      writes: [],
      held: [],
      invalid: new SyncError({ status: 409, code: "id_taken" }),
    } satisfies EventPlan;
  yield* consider({ kind: "series", routine: node.id }, parent, master, { kind: "id", id: series });
  for (const day of [...days.keys()].toSorted()) {
    const fields = days.get(day);
    if (fields === undefined) continue;
    const listed = exceptions.get(day);
    yield* consider(
      { kind: "instance", routine: node.id, day },
      fields,
      listed,
      listed === undefined
        ? {
            kind: "lookup",
            series,
            original: { day, at: routine.at, zone: routine.zone },
            zone: calendar.zone,
          }
        : { kind: "id", id: listed.id },
    );
  }
  return { routine: node.id, writes, held, invalid: null } satisfies EventPlan;
});

/** What a pass plans against: the store's nodes, Google's list, the time, and where an event's link goes back to. */
interface PlanInput {
  readonly nodes: ReadonlyMap<string, NodeLike>;
  readonly list: readonly RemoteEvent[];
  readonly now: number;
  readonly origin: string;
}

/**
 * One calendar's pass: each of its events against what Google lists, and
 * the end of each series of kb's whose event is no longer on it.
 */
export const reconcile = Effect.fn("routines.reconcile")(function* (
  calendar: CalendarConfig,
  routines: readonly NodeLike[],
  { nodes, list, now, origin }: PlanInput,
) {
  const remote = { byId: new Map(list.map((event) => [event.id, event])), list };
  const events: EventPlan[] = [];
  for (const node of routines) events.push(yield* planEvent(calendar, node, nodes, remote, origin));
  const here = new Set(routines.map((node) => node.id));
  const endings: Ending[] = [];
  for (const event of list) {
    // Only a series or one-off of kb's, whose event is not on this calendar now.
    if (event.exception !== null || event.fields === null || !owned(event)) continue;
    if (here.has(event.fields.nodeId)) continue;
    const fields = event.fields;
    const ended =
      fields.recurrence.length === 0
        ? { ...fields, status: "cancelled" as const }
        : endSeries(fields, yesterday(now, fields.start.zone ?? calendar.zone));
    if (ended === fields) continue;
    endings.push({
      routine: fields.nodeId,
      target: { kind: "calendar", calendar: calendar.id },
      fields: ended,
      to: { kind: "id", id: event.id },
    });
  }
  return { endings, events } satisfies CalendarPlan;
});
