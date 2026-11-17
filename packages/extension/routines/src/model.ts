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
export interface CalendarResult {
  readonly id: string;
  readonly url: string;
}
/** Where one write stands: waiting, sent, or failed with its code as the message. */
export const SyncStatus = Schema.Struct({
  state: Schema.Literals(["pending", "synced", "error"]),
  message: Schema.String,
  /** Google's id for the event the write is for, once Google has answered. */
  eventId: Schema.optionalKey(Schema.String),
  /** Google's own link to that event (`htmlLink`). */
  url: Schema.optionalKey(Schema.String),
  /** When kb last sent it, or last found Google holding it. */
  at: Schema.optionalKey(Schema.String),
});
export type SyncStatus = typeof SyncStatus.Type;
/**
 * The sync host's statuses (docs/research/2026-11-02-kb-routines-gcal.md →
 * Status lives in the host): one per write target. An event's series is
 * keyed by its node, an instance by its event's node and its original day,
 * and a calendar by its node, for its list call and the endings of series
 * whose events are gone. `held` are the events whose ending waits for a
 * release.
 */
export const SyncStatuses = Schema.Struct({
  series: Schema.Record(Schema.String, SyncStatus),
  instances: Schema.Record(Schema.String, Schema.Record(Schema.String, SyncStatus)),
  calendars: Schema.Record(Schema.String, SyncStatus),
  held: Schema.Array(Schema.String),
});
export type SyncStatuses = typeof SyncStatuses.Type;
export const NO_STATUSES: SyncStatuses = { series: {}, instances: {}, calendars: {}, held: [] };
/** What a page sends on the family's status channel (`STATUS_CHANNEL`) to hear each new {@link SyncStatuses}. */
export const WatchStatuses = Schema.Struct({ watch: Schema.Literal(true) });
export const WATCH_STATUSES: typeof WatchStatuses.Type = { watch: true };
/**
 * One event kb's calendar holds, as the port lists it: a series, a one-off
 * or an exception, never an instance nobody changed.
 */
export interface RemoteEvent {
  readonly id: string;
  /** Google's link to it; empty where it gives none. */
  readonly url: string;
  /** For an exception: its series' id, and the start it replaces (`originalStartTime`). */
  readonly exception: { readonly series: string; readonly original: EventTime } | null;
  readonly cancelled: boolean;
  /** What kb put there, as the adapter decodes it; null for a cancelled event or another's. */
  readonly fields: EventFields | null;
  /** The digest kb stored with it (`kbSent`); null for a cancelled event or one from before. */
  readonly digest: string | null;
}
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
