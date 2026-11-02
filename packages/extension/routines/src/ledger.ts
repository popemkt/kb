import { Effect, Schema, Stream, SubscriptionRef } from "effect";
import { LedgerLog, SyncError, UnitRecord } from "./model.ts";
import type { SyncLedger } from "./ports.ts";

const Lease = Schema.Struct({ holder: Schema.String, expires: Schema.Finite });
export const LedgerState = Schema.Struct({
  units: Schema.Record(Schema.String, UnitRecord),
  cursors: Schema.Record(Schema.String, Schema.String),
  leases: Schema.Record(Schema.String, Lease),
  logs: Schema.Array(LedgerLog),
  logStart: Schema.Int,
});
export type LedgerState = typeof LedgerState.Type;
export interface LedgerSnapshot {
  readonly revision: string;
  readonly state: LedgerState;
}
/** Atomic storage beneath the one implementation of ledger operations. */
export interface LedgerStorage {
  readonly read: Effect.Effect<LedgerSnapshot, SyncError>;
  readonly comparePut: (expected: string, state: LedgerState) => Effect.Effect<boolean, SyncError>;
  readonly changes: Stream.Stream<string, SyncError>;
}
export function emptyLedgerState(): LedgerState {
  return { units: {}, cursors: {}, leases: {}, logs: [], logStart: 0 };
}
const own = <T>(record: Readonly<Record<string, T>>, key: string): T | undefined =>
  Object.hasOwn(record, key) ? record[key] : undefined;

type Change<A> = { readonly state: LedgerState; readonly value: A };

/** CAS retries are shared by all adapters, including lease acquisition. */
export function ledgerFromStorage(storage: LedgerStorage): SyncLedger {
  const change = Effect.fn("routines.ledger.change")(function* <A>(
    update: (state: LedgerState) => Change<A>,
  ) {
    for (let attempt = 0; attempt < 32; attempt++) {
      const before = yield* storage.read;
      const next = update(before.state);
      if (next.state === before.state || (yield* storage.comparePut(before.revision, next.state))) {
        return next.value;
      }
      yield* Effect.yieldNow;
    }
    return yield* new SyncError({ status: 409, code: "ledger_contention" });
  });
  const allUnits = storage.read.pipe(Effect.map(({ state }) => Object.values(state.units)));
  const get = (key: string) =>
    storage.read.pipe(Effect.map(({ state }) => own(state.units, key) ?? null));
  return {
    unit: {
      get,
      put: (record, expectedVersion) =>
        change((state) => {
          const current = own(state.units, record.key);
          if ((current?.version ?? 0) !== expectedVersion) return { state, value: false };
          return {
            state: {
              ...state,
              units: { ...state.units, [record.key]: { ...record, version: expectedVersion + 1 } },
            },
            value: true,
          };
        }),
      due: (now, limit) =>
        allUnits.pipe(
          Effect.map((units) =>
            units
              .filter(
                (unit) =>
                  (unit.state === "dirty" || unit.state === "retry") && unit.nextAttemptAt <= now,
              )
              .toSorted((a, b) => a.nextAttemptAt - b.nextAttemptAt || a.key.localeCompare(b.key))
              .slice(0, Math.max(0, limit)),
          ),
        ),
      byRoutine: (id) =>
        allUnits.pipe(Effect.map((units) => units.filter((unit) => unit.routineId === id))),
      all: (calendar) =>
        allUnits.pipe(Effect.map((units) => units.filter((unit) => unit.calendar === calendar))),
    },
    cursor: {
      get: (name) => storage.read.pipe(Effect.map(({ state }) => own(state.cursors, name) ?? null)),
      set: (name, value) =>
        change((state) => ({
          state:
            own(state.cursors, name) === value
              ? state
              : { ...state, cursors: { ...state.cursors, [name]: value } },
          value: undefined,
        })),
    },
    lease: {
      acquire: (name, holder, now, ttl) =>
        change((state) => {
          const current = own(state.leases, name);
          if (
            ttl <= 0 ||
            (current !== undefined && current.expires > now && current.holder !== holder)
          )
            return { state, value: false };
          return {
            state: {
              ...state,
              leases: { ...state.leases, [name]: { holder, expires: now + ttl } },
            },
            value: true,
          };
        }),
      renew: (name, holder, now, ttl) =>
        change((state) => {
          const current = own(state.leases, name);
          if (ttl <= 0 || current?.holder !== holder || current.expires <= now)
            return { state, value: false };
          return {
            state: {
              ...state,
              leases: { ...state.leases, [name]: { holder, expires: now + ttl } },
            },
            value: true,
          };
        }),
      release: (name, holder) =>
        change((state) => {
          if (own(state.leases, name)?.holder !== holder) return { state, value: undefined };
          const leases = Object.fromEntries(
            Object.entries(state.leases).filter(([key]) => key !== name),
          );
          return { state: { ...state, leases }, value: undefined };
        }),
    },
    log: {
      append: (entry) =>
        change((state) => {
          const logs = [...state.logs, entry];
          const discarded = Math.max(0, logs.length - 2_000);
          return {
            state: { ...state, logs: logs.slice(discarded), logStart: state.logStart + discarded },
            value: undefined,
          };
        }),
      tail: (limit) =>
        storage.read.pipe(
          Effect.map(({ state }) =>
            state.logs.slice(-Math.max(0, limit)).slice(0, Math.max(0, limit)),
          ),
        ),
    },
    changes: storage.changes,
  };
}

export const makeMemoryLedger = Effect.fn("routines.makeMemoryLedger")(function* () {
  const ref = yield* SubscriptionRef.make<LedgerSnapshot>({
    revision: "0",
    state: emptyLedgerState(),
  });
  const storage: LedgerStorage = {
    read: SubscriptionRef.get(ref).pipe(Effect.map((value) => structuredClone(value))),
    comparePut: (expected, state) =>
      SubscriptionRef.modify(ref, (current) =>
        current.revision !== expected
          ? ([false, current] as const)
          : ([
              true,
              { revision: String(Number(current.revision) + 1), state: structuredClone(state) },
            ] as const),
      ),
    changes: SubscriptionRef.changes(ref).pipe(Stream.map(({ revision }) => revision)),
  };
  return ledgerFromStorage(storage);
});
