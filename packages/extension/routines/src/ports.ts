import type { Effect, Stream } from "effect";
import {
  SyncError,
  type EventFields,
  type EventTime,
  type LedgerLog,
  type RemoteEvent,
  type UnitRecord,
} from "./model.ts";

export type CalendarMutation =
  | { readonly kind: "insert"; readonly id: string; readonly fields: EventFields }
  | {
      readonly kind: "update";
      readonly id: string;
      readonly fields: EventFields;
      readonly etag: string;
    }
  | { readonly kind: "remove"; readonly id: string; readonly etag: string };
export type MutationOutcome =
  | { readonly id: string; readonly ok: true; readonly event: RemoteEvent | null }
  | { readonly id: string; readonly ok: false; readonly error: SyncError };

/** Batches contain at most 50 calls; every update/removal is conditional. */
export interface CalendarPort {
  readonly create: (name: string, zone: string) => Effect.Effect<string, SyncError>;
  readonly get: (calendar: string, id: string) => Effect.Effect<RemoteEvent, SyncError>;
  readonly write: (
    calendar: string,
    changes: readonly CalendarMutation[],
  ) => Effect.Effect<readonly MutationOutcome[], SyncError>;
  readonly instance: (
    calendar: string,
    series: string,
    original: EventTime,
    calendarZone: string,
  ) => Effect.Effect<RemoteEvent, SyncError>;
  readonly list: (
    calendar: string,
    token: string | null,
    page: string | null,
  ) => Effect.Effect<
    {
      readonly events: readonly RemoteEvent[];
      readonly nextPage: string | null;
      readonly nextToken: string | null;
    },
    SyncError
  >;
}

/** All adapters obey ledgerContract; no secrets or response bodies enter records. */
export interface SyncLedger {
  readonly unit: {
    readonly get: (key: string) => Effect.Effect<UnitRecord | null, SyncError>;
    readonly put: (
      record: UnitRecord,
      expectedVersion: number,
    ) => Effect.Effect<boolean, SyncError>;
    readonly due: (now: number, limit: number) => Effect.Effect<readonly UnitRecord[], SyncError>;
    readonly byRoutine: (id: string) => Effect.Effect<readonly UnitRecord[], SyncError>;
    readonly all: (calendar: string) => Effect.Effect<readonly UnitRecord[], SyncError>;
  };
  readonly cursor: {
    readonly get: (name: string) => Effect.Effect<string | null, SyncError>;
    readonly set: (name: string, value: string) => Effect.Effect<void, SyncError>;
  };
  readonly lease: {
    readonly acquire: (
      name: string,
      holder: string,
      now: number,
      ttl: number,
    ) => Effect.Effect<boolean, SyncError>;
    readonly renew: (
      name: string,
      holder: string,
      now: number,
      ttl: number,
    ) => Effect.Effect<boolean, SyncError>;
    readonly release: (name: string, holder: string) => Effect.Effect<void, SyncError>;
  };
  readonly log: {
    readonly append: (entry: LedgerLog) => Effect.Effect<void, SyncError>;
    readonly tail: (limit: number) => Effect.Effect<readonly LedgerLog[], SyncError>;
  };
  readonly changes: Stream.Stream<string, SyncError>;
}

/** Input guarantees shared by every calendar adapter. */
export function validateCalendarBatch(changes: readonly CalendarMutation[]): void {
  if (changes.length > 50 || new Set(changes.map((change) => change.id)).size !== changes.length) {
    throw new SyncError({ status: 400, code: "invalid_batch" });
  }
  for (const change of changes) {
    if (change.kind === "insert" && !/^[0-9a-v]{5,1024}$/.test(change.id)) {
      throw new SyncError({ status: 400, code: "invalid_id" });
    }
    if (change.kind !== "insert" && (change.etag.trim() === "" || /[\r\n]/.test(change.etag))) {
      throw new SyncError({ status: 409, code: "missing_etag" });
    }
  }
}
