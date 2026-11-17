import type { Effect } from "effect";
import type { CalendarResult, EventFields, EventTime, RemoteEvent, SyncError } from "./model.ts";

/**
 * kb owns all projected fields. Repeating put is idempotent, overwrites Google
 * edits, and stores the fields' digest (`sentDigest`) with the event. `list`
 * reads back what kb's calendar holds: each series, one-off and exception,
 * with what kb put there. `instance` finds an instance Google holds no
 * exception for, by its original local start. No operation imports remote
 * event content into kb (docs/research/2026-11-02-kb-routines-gcal.md →
 * The port).
 */
export interface CalendarPort {
  readonly create: (name: string, zone: string) => Effect.Effect<string, SyncError>;
  readonly put: (
    calendar: string,
    id: string,
    fields: EventFields,
  ) => Effect.Effect<CalendarResult, SyncError>;
  readonly list: (calendar: string) => Effect.Effect<readonly RemoteEvent[], SyncError>;
  readonly instance: (
    calendar: string,
    series: string,
    original: EventTime,
    zone: string,
  ) => Effect.Effect<CalendarResult, SyncError>;
}
