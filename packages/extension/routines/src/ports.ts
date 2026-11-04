import type { Effect } from "effect";
import type { CalendarResult, EventFields, EventTime, SyncError } from "./model.ts";

/** kb owns all projected fields. Repeating put is idempotent and overwrites Google edits.
 * instance resolves Google's opaque exception identity from its original local start.
 * No operation imports remote event content into kb.
 */
export interface CalendarPort {
  readonly create: (name: string, zone: string) => Effect.Effect<string, SyncError>;
  readonly put: (
    calendar: string,
    id: string,
    fields: EventFields,
  ) => Effect.Effect<CalendarResult, SyncError>;
  readonly instance: (
    calendar: string,
    series: string,
    original: EventTime,
    zone: string,
  ) => Effect.Effect<CalendarResult, SyncError>;
}
