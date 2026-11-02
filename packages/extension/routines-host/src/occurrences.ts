import { Clock, DateTime, Effect, Option } from "effect";
import { addDays, formatDay, parseDay, typeRefsOf } from "@kb/model";
import {
  project,
  projectionFingerprint,
  readOccurrence,
  readRoutine,
  ROUTINE_TAGS as T,
  SyncError,
  type Occurrence,
  type UnitRecord,
  type RemoteEvent,
} from "@kb/routines";
import type { EngineContext } from "./context.ts";
import type { CalendarSession } from "./session.ts";

function occurrenceFacts(context: EngineContext, routineId: string): readonly Occurrence[] {
  const node = context.nodes.get(routineId);
  const facts = (node?.children ?? []).flatMap((id) => {
    const child = context.nodes.get(id);
    return child !== undefined && typeRefsOf(child).includes(T.occurrence)
      ? [readOccurrence(child)]
      : [];
  });
  if (new Set(facts.map((fact) => fact.on)).size !== facts.length)
    throw new SyncError({ status: 400, code: "duplicate_occurrence" });
  return facts;
}
export function localProjection(context: EngineContext, unit: UnitRecord, zone: string) {
  const node = context.nodes.get(unit.routineId);
  if (node === undefined || !typeRefsOf(node).includes(T.routine)) return null;
  const { routine, calendar } = readRoutine(node, zone);
  if (calendar !== unit.calendar) return null;
  const facts = occurrenceFacts(context, unit.routineId);
  const target =
    unit.kind === "exception"
      ? {
          kind: "instance" as const,
          on: unit.day ?? "",
          occurrence: facts.find((fact) => fact.on === unit.day) ?? null,
        }
      : {
          kind: "parent" as const,
          occurrence:
            routine.rrule.trim() === ""
              ? (facts.find((fact) => fact.on === routine.starts) ?? null)
              : null,
        };
  return project(
    routine,
    context.options.origin + "/node/" + encodeURIComponent(routine.id),
    unit.generation,
    target,
  );
}

function occurrenceRecord(
  parent: UnitRecord,
  remote: RemoteEvent,
  previous: UnitRecord | null,
  detail: { on: string; fact: Occurrence | undefined; source: string; at: number },
): UnitRecord {
  const { on, fact, source, at } = detail;
  return {
    ...parent,
    key: remote.id,
    day: on,
    occurrenceId: fact?.id ?? null,
    kind: "exception",
    source,
    state: previous?.state === "deleted" ? "deleted" : "dirty",
    base: previous?.base ?? remote.fields,
    etag: remote.etag,
    version: previous?.version ?? 0,
    nextAttemptAt: at,
    attempts: 0,
    pending: previous?.pending ?? null,
    conflict: null,
    lastError: null,
  };
}

/** Re-find instances by original day after every parent write, including fact removal. */
export const queueOccurrences = Effect.fn("routines.queueOccurrences")(function* (
  context: EngineContext,
  session: CalendarSession,
  parent: UnitRecord,
) {
  if (parent.kind !== "series" || parent.state === "ended" || !context.nodes.has(parent.routineId))
    return true;
  const at = yield* Clock.currentTimeMillis;
  const zone = parent.base?.start.zone ?? session.binding.calendar.zone;
  const today = DateTime.formatIsoDate(DateTime.makeZonedUnsafe(at, { timeZone: zone }));
  const day = parseDay(today);
  if (day === null) return yield* new SyncError({ status: 400, code: "invalid_day" });
  const from = formatDay(addDays(day, -30));
  const to = formatDay(addDays(day, 400));
  const facts = yield* Effect.try({
    try: () => occurrenceFacts(context, parent.routineId),
    catch: () => new SyncError({ status: 400, code: "invalid_rule" }),
  });
  const known = (yield* context.options.ledger.unit.byRoutine(parent.routineId)).filter(
    (unit) =>
      unit.kind === "exception" &&
      unit.generation === parent.generation &&
      unit.calendar === parent.calendar,
  );
  const days = new Set([
    ...facts.map((fact) => fact.on),
    ...known.flatMap((unit) => (unit.day === null ? [] : [unit.day])),
  ]);
  for (const on of [...days].toSorted()) {
    if (on < from || on > to) continue;
    const fact = facts.find((entry) => entry.on === on);
    const source = yield* projectionFingerprint([parent.source, fact ?? null]);
    const existing = known.find((unit) => unit.day === on);
    if (existing?.source === source) continue;
    const found = yield* session.call(1, () =>
      session.client.instance(
        session.binding.calendar.calendarId,
        parent.key,
        { ...(parent.base?.start ?? { day: on, at: null, zone: null }), day: on },
        session.binding.calendar.zone,
      ),
    );
    if (Option.isNone(found)) return false;
    const remote = found.value;
    const previous = yield* context.options.ledger.unit.get(remote.id);
    const next = occurrenceRecord(parent, remote, previous, { on, fact, source, at });
    yield* context.options.ledger.unit.put(next, previous?.version ?? 0);
  }
  return true;
});
