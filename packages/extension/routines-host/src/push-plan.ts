import { DateTime } from "effect";
import { addDays, canonicalJson, formatDay, parseDay, type NodeLike } from "@kb/model";
import {
  endSeries,
  project,
  readRoutine,
  routineOccurrences,
  SyncError,
  type CalendarBinding,
  type EventFields,
  type EventTime,
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
/** What one snapshot publishes, keyed by target: its series parent, and each day its facts hold. */
const PARENT = "parent";
function published(
  snapshot: Snapshot,
  origin: string,
): ReadonlyMap<string, Omit<PushOperation, "retiresSeries">> {
  const routine = readRoutine(snapshot.node, snapshot.binding.calendar.zone).routine;
  const backlink = origin + "/node/" + encodeURIComponent(snapshot.node.id);
  const desired = routineOccurrences(snapshot.node, snapshot.nodes);
  // A one-off's one instance is its event: the fact on its day is that event's own state.
  const oneOff = routine.rrule.trim() === "";
  const out = new Map<string, Omit<PushOperation, "retiresSeries">>([
    [
      PARENT,
      {
        snapshot,
        fields: project(routine, backlink, 0, {
          kind: "parent",
          occurrence: oneOff ? (desired.get(routine.starts)?.occurrence ?? null) : null,
        }),
        original: null,
        node: snapshot.node,
      },
    ],
  ]);
  if (oneOff) return out;
  for (const [day, fact] of desired)
    out.set(day, {
      snapshot,
      fields: project(routine, backlink, 0, {
        kind: "instance",
        on: day,
        occurrence: fact.occurrence,
      }),
      original: { day, at: routine.at, zone: routine.zone },
      node: fact.node,
    });
  return out;
}

/**
 * One plan owns retirement of previous remote identities and publication of
 * current ones. It sends what changed since `previous`, the snapshot last
 * sent: the parent when the series' own event changed, a day whose fact is
 * new or changed, and a day whose fact is gone, back to the series' default.
 * With no `previous`, or a new destination, it sends everything.
 */
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
  const desired = published(current, origin);
  const before =
    previous === undefined || retire !== null
      ? new Map<string, Omit<PushOperation, "retiresSeries">>()
      : published(previous, origin);
  const sent = (key: string, fields: EventFields) => {
    const was = before.get(key);
    return was !== undefined && canonicalJson(was.fields) === canonicalJson(fields);
  };
  const parent = desired.get(PARENT);
  if (parent !== undefined && !sent(PARENT, parent.fields))
    operations.push({ ...parent, retiresSeries: false });
  const routine = readRoutine(current.node, current.binding.calendar.zone).routine;
  // A one-off has no instances of its own: its day's fact is its parent's state.
  if (routine.rrule.trim() === "") return operations;
  const backlink = origin + "/node/" + encodeURIComponent(current.node.id);
  for (const day of before.keys()) {
    if (day === PARENT || desired.has(day)) continue;
    operations.push({
      snapshot: current,
      fields: project(routine, backlink, 0, { kind: "instance", on: day, occurrence: null }),
      original: { day, at: routine.at, zone: routine.zone },
      node: null,
      retiresSeries: false,
    });
  }
  for (const [day, operation] of desired)
    if (day !== PARENT && !sent(day, operation.fields))
      operations.push({ ...operation, retiresSeries: false });
  return operations;
}
