import { DateTime } from "effect";
import { addDays, canonicalJson, formatDay, parseDay, typeRefsOf, type NodeLike } from "@kb/model";
import {
  endSeries,
  project,
  readOccurrence,
  readRoutine,
  ROUTINE_TAGS as T,
  SyncError,
  type CalendarBinding,
  type EventFields,
  type EventTime,
  type Occurrence,
} from "@kb/routines";
export interface Snapshot {
  readonly node: NodeLike;
  readonly nodes: ReadonlyMap<string, NodeLike>;
  readonly binding: CalendarBinding;
  readonly removed: boolean;
}
export interface PushOperation {
  readonly snapshot: Snapshot;
  readonly fields: EventFields;
  readonly original: EventTime | null;
  readonly node: NodeLike | null;
  readonly retiresSeries: boolean;
}
const destination = (snapshot: Snapshot) =>
  canonicalJson([snapshot.binding.calendar.id, snapshot.binding.calendar.calendarId]);
function facts(snapshot: Snapshot) {
  const found = new Map<string, { node: NodeLike; occurrence: Occurrence }>();
  for (const id of snapshot.node.children) {
    const node = snapshot.nodes.get(id);
    if (node === undefined || !typeRefsOf(node).includes(T.occurrence)) continue;
    const occurrence = readOccurrence(node);
    if (found.has(occurrence.on))
      throw new SyncError({ status: 400, code: "duplicate_occurrence" });
    found.set(occurrence.on, { node, occurrence });
  }
  return found;
}
/** One plan owns retirement of previous remote identities and publication of current ones. */
export function pushPlan(
  current: Snapshot,
  previous: Snapshot | undefined,
  now: number,
  origin: string,
): readonly PushOperation[] {
  const operations: PushOperation[] = [];
  const retire = current.removed
    ? (previous ?? current)
    : previous !== undefined && destination(previous) !== destination(current)
      ? previous
      : null;
  if (retire !== null) {
    const routine = readRoutine(retire.node, retire.binding.calendar.zone).routine;
    const today = parseDay(
      DateTime.formatIsoDate(DateTime.makeZonedUnsafe(now, { timeZone: routine.zone })),
    );
    if (today === null) throw new SyncError({ status: 400, code: "invalid_rule" });
    const fields = project(routine, origin + "/node/" + encodeURIComponent(retire.node.id), 0);
    operations.push({
      snapshot: retire,
      fields:
        fields.recurrence.length === 0
          ? { ...fields, status: "cancelled" }
          : endSeries(fields, formatDay(addDays(today, -1))),
      original: null,
      node: null,
      retiresSeries: true,
    });
  }
  if (current.removed) return operations;
  const routine = readRoutine(current.node, current.binding.calendar.zone).routine;
  const backlink = origin + "/node/" + encodeURIComponent(current.node.id);
  operations.push({
    snapshot: current,
    fields: project(routine, backlink, 0),
    original: null,
    node: current.node,
    retiresSeries: false,
  });
  const desired = facts(current);
  const old =
    previous === undefined || retire !== null
      ? new Map<string, { node: NodeLike; occurrence: Occurrence }>()
      : facts(previous);
  for (const [day] of old) {
    if (desired.has(day)) continue;
    operations.push({
      snapshot: current,
      fields: project(routine, backlink, 0, { kind: "instance", on: day, occurrence: null }),
      original: { day, at: routine.at, zone: routine.zone },
      node: null,
      retiresSeries: false,
    });
  }
  for (const [day, fact] of desired)
    operations.push({
      snapshot: current,
      fields: project(routine, backlink, 0, {
        kind: "instance",
        on: day,
        occurrence: fact.occurrence,
      }),
      original: { day, at: routine.at, zone: routine.zone },
      node: fact.node,
      retiresSeries: false,
    });
  return operations;
}
