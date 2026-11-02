import { Schema } from "effect";

const SyncFailure = Schema.Struct({ status: Schema.Int, code: Schema.String });

export class SyncError extends Schema.TaggedError<SyncError>()("Routines/SyncError", {
  ...SyncFailure.fields,
  retryAfter: Schema.optionalKey(Schema.Finite),
}) {}

export const EventTime = Schema.Struct({
  day: Schema.String,
  at: Schema.NullOr(Schema.String),
  zone: Schema.NullOr(Schema.String),
});
export type EventTime = typeof EventTime.Type;

/** Semantic fields: the adapter owns Google's title decoration and wire shape. */
export const EventFields = Schema.Struct({
  title: Schema.String,
  start: EventTime,
  end: EventTime,
  recurrence: Schema.Array(Schema.String),
  status: Schema.Literals(["confirmed", "cancelled", "tentative"]),
  nodeId: Schema.String,
  unit: Schema.String,
  generation: Schema.Int,
  backlink: Schema.String,
  done: Schema.Boolean,
});
export type EventFields = typeof EventFields.Type;
export const SHARED_EVENT_FIELDS = [
  "title",
  "start",
  "end",
  "recurrence",
  "status",
] as const satisfies readonly (keyof EventFields)[];
export const RemoteEvent = Schema.Struct({
  id: Schema.String,
  etag: Schema.String,
  url: Schema.String,
  fields: Schema.NullOr(EventFields),
  deleted: Schema.Boolean,
  runner: Schema.NullOr(Schema.String),
  seriesId: Schema.NullOr(Schema.String),
  originalStart: Schema.NullOr(EventTime),
  ownedDrift: Schema.Boolean,
});
export type RemoteEvent = typeof RemoteEvent.Type;
export const SyncConflict = Schema.Struct({
  base: Schema.NullOr(EventFields),
  local: Schema.NullOr(EventFields),
  remote: Schema.NullOr(EventFields),
});
export type SyncConflict = typeof SyncConflict.Type;
export const PendingWrite = Schema.Struct({
  id: Schema.String,
  fields: Schema.NullOr(EventFields),
  base: Schema.NullOr(EventFields),
  localRev: Schema.Int,
  source: Schema.String,
  outcome: Schema.Literals(["synced", "conflict", "ended"]),
  conflict: Schema.NullOr(SyncConflict),
});
export const UnitRecord = Schema.Struct({
  key: Schema.String,
  routineId: Schema.String,
  occurrenceId: Schema.NullOr(Schema.String),
  day: Schema.NullOr(Schema.String),
  calendar: Schema.String,
  kind: Schema.Literals(["series", "one-off", "exception"]),
  generation: Schema.Int,
  base: Schema.NullOr(EventFields),
  etag: Schema.NullOr(Schema.String),
  state: Schema.Literals([
    "dirty",
    "pushing",
    "synced",
    "retry",
    "conflict",
    "deleted",
    "failed",
    "held",
    "ended",
  ]),
  dirtySince: Schema.Finite,
  lastTouch: Schema.Finite,
  nextAttemptAt: Schema.Finite,
  attempts: Schema.Int,
  lastError: Schema.NullOr(SyncFailure),
  conflict: Schema.NullOr(SyncConflict),
  pending: Schema.NullOr(PendingWrite),
  localRev: Schema.Int,
  source: Schema.String,
  inputs: Schema.Array(Schema.String),
  version: Schema.Int,
});
export type UnitRecord = typeof UnitRecord.Type;
export const LedgerLog = Schema.Struct({
  at: Schema.Finite,
  code: Schema.String,
  key: Schema.NullOr(Schema.String),
});
export type LedgerLog = typeof LedgerLog.Type;
export interface Routine {
  readonly id: string;
  readonly title: string;
  readonly starts: string;
  readonly at: string | null;
  readonly duration: number;
  readonly zone: string;
  readonly rrule: string;
  readonly until: string | null;
  readonly repeatsFrom: "schedule" | "completion";
}
export interface Occurrence {
  readonly id: string;
  readonly on: string;
  readonly state: "done" | "skipped" | "moved";
  readonly movedTo: string | null;
  readonly at: string | null;
}

export type ProjectionTarget =
  | { readonly kind: "parent"; readonly occurrence?: Occurrence | null }
  | { readonly kind: "instance"; readonly on: string; readonly occurrence: Occurrence | null };
