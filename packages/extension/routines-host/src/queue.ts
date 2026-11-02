import { Effect } from "effect";
import { firstRef, firstStr, typeRefsOf, type NodeLike } from "@kb/model";
import {
  eventId,
  projectionFingerprint,
  routineInputs,
  settleAt,
  ROUTINE_FIELDS as F,
  ROUTINE_TAGS as T,
  type CalendarBinding,
  type SyncLedger,
  type UnitRecord,
  SyncError,
} from "@kb/routines";

export type Touch = {
  readonly kind: "change" | "startup" | "sync-now" | "reconcile";
  readonly at: number;
  readonly revision: number;
};
function unchanged(record: UnitRecord, source: string, touch: Touch): boolean {
  return (
    source === record.source &&
    touch.kind !== "sync-now" &&
    record.pending === null &&
    (touch.kind !== "reconcile" || ["failed", "held", "deleted", "ended"].includes(record.state))
  );
}
function routineSource(
  nodes: ReadonlyMap<string, NodeLike>,
  routineId: string,
  binding: CalendarBinding,
) {
  const node = nodes.get(routineId);
  const current =
    node !== undefined &&
    typeRefsOf(node).includes(T.routine) &&
    firstRef(F.calendar)(node.props) === binding.calendar.id
      ? node
      : undefined;
  const inputs =
    current === undefined ? null : routineInputs(current, nodes, binding.calendar.zone);
  return { current, inputs };
}
function touchedRecord(options: {
  current: NodeLike | undefined;
  fresh: UnitRecord;
  source: string;
  inputs: ReturnType<typeof routineInputs> | null;
  binding: CalendarBinding;
  touch: Touch;
}) {
  const { current, fresh, source, inputs, binding, touch } = options;
  return (record: UnitRecord): UnitRecord => {
    const active = record.state === "dirty" || record.state === "retry" || record.pending !== null;
    const first =
      record.pending !== null && record.source === record.pending.source
        ? touch.at
        : active
          ? record.dirtySince
          : touch.at;
    const last = Math.max(record.lastTouch, touch.at);
    const state = record.state === "deleted" ? "deleted" : "dirty";
    return {
      ...record,
      kind: current === undefined ? record.kind : fresh.kind,
      source,
      inputs: [
        ...new Set([
          ...(inputs?.ids ?? record.inputs),
          binding.calendar.id,
          ...(binding.account === null ? [] : [binding.account.id]),
        ]),
      ],
      localRev: Math.max(record.localRev, touch.revision),
      state,
      dirtySince: first,
      lastTouch: last,
      nextAttemptAt:
        touch.kind === "sync-now" || (touch.kind === "startup" && record.pending !== null)
          ? touch.at
          : settleAt(first, last),
      attempts: source === record.source && touch.kind !== "sync-now" ? record.attempts : 0,
    };
  };
}

export class SyncQueue {
  readonly ledger: SyncLedger;
  constructor(ledger: SyncLedger) {
    this.ledger = ledger;
  }
  readonly mutate = Effect.fn("routines.queue.mutate")(function* (
    this: SyncQueue,
    key: string,
    update: (record: UnitRecord) => UnitRecord,
  ) {
    for (let attempt = 0; attempt < 32; attempt++) {
      const current = yield* this.ledger.unit.get(key);
      if (current === null) return null;
      const next = update(current);
      if (yield* this.ledger.unit.put(next, current.version))
        return { ...next, version: current.version + 1 };
    }
    return yield* new SyncError({ status: 409, code: "ledger_contention" });
  });
  readonly touch = Effect.fn("routines.queue.touch")(function* (
    this: SyncQueue,
    routineId: string,
    binding: CalendarBinding,
    nodes: ReadonlyMap<string, NodeLike>,
    touch: Touch,
  ) {
    const known = (yield* this.ledger.unit.byRoutine(routineId)).filter(
      (unit) => unit.calendar === binding.calendar.id && unit.kind !== "exception",
    );
    const previous = known.toSorted((a, b) => b.generation - a.generation)[0];
    const { current, inputs } = routineSource(nodes, routineId, binding);
    const source = yield* projectionFingerprint(inputs?.value ?? null);
    if (previous !== undefined && unchanged(previous, source, touch)) return previous;
    if (previous === undefined && current === undefined) return null;
    const generation = previous?.generation ?? 0;
    const key =
      previous?.key ?? (yield* eventId(binding.calendar.id, routineId, "series", generation));
    const fresh: UnitRecord = {
      key,
      routineId,
      calendar: binding.calendar.id,
      occurrenceId: null,
      day: null,
      kind: (firstStr(F.rrule)(current?.props ?? {}) ?? "").trim() === "" ? "one-off" : "series",
      generation,
      base: null,
      etag: null,
      state: "dirty",
      dirtySince: touch.at,
      lastTouch: touch.at,
      nextAttemptAt: touch.at + 5_000,
      attempts: 0,
      lastError: null,
      conflict: null,
      pending: null,
      source,
      localRev: touch.revision,
      inputs: [],
      version: 0,
    };
    const update = touchedRecord({ current, fresh, source, inputs, binding, touch });
    if (previous !== undefined) return yield* this.mutate(key, update);
    if (yield* this.ledger.unit.put(update(fresh), 0)) return yield* this.ledger.unit.get(key);
    return yield* this.mutate(key, update);
  });
}
