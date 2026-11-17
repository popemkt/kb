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
export interface SyncStatus {
  readonly state: "pending" | "synced" | "error";
  readonly message: string;
  readonly eventId?: string;
  readonly url?: string;
  readonly at?: string;
}
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
