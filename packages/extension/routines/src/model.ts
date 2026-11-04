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
