import { Deferred, Effect, Fiber, Stream, type Scope } from "effect";
import type { SyncError, UnitRecord } from "./model.ts";
import type { SyncLedger } from "./ports.ts";

export interface LedgerFixture {
  readonly ledger: SyncLedger;
  readonly reopen: Effect.Effect<SyncLedger, SyncError>;
}
export interface ContractAssertions {
  readonly equal: (actual: unknown, expected: unknown) => void;
  readonly different: (actual: unknown, expected: unknown) => void;
}
export type ContractTest = (
  name: string,
  effect: Effect.Effect<void, SyncError, Scope.Scope>,
) => void;

export function contractUnit(key: string, due = 0): UnitRecord {
  return {
    key,
    routineId: "routine",
    occurrenceId: null,
    day: null,
    calendar: "calendar",
    kind: "series",
    generation: 0,
    base: null,
    etag: null,
    state: "dirty",
    dirtySince: 0,
    lastTouch: 0,
    nextAttemptAt: due,
    attempts: 0,
    lastError: null,
    conflict: null,
    version: 0,
    pending: null,
    localRev: 0,
    source: "",
    inputs: ["routine"],
  };
}

/** The same properties run against every SyncLedger implementation. */
export function ledgerContract(
  test: ContractTest,
  fixture: Effect.Effect<LedgerFixture, SyncError, Scope.Scope>,
  assert: ContractAssertions,
): void {
  test(
    "refuses stale versions and orders due units",
    Effect.gen(function* () {
      const { ledger } = yield* fixture;
      assert.equal(yield* ledger.unit.put(contractUnit("later", 20), 0), true);
      assert.equal(yield* ledger.unit.put(contractUnit("early", 10), 0), true);
      assert.equal(yield* ledger.unit.put(contractUnit("early", 5), 0), false);
      assert.equal((yield* ledger.unit.get("early"))?.version, 1);
      assert.equal(
        (yield* ledger.unit.due(20, 1)).map((unit) => unit.key),
        ["early"],
      );
      assert.equal((yield* ledger.unit.due(9, 10)).length, 0);
      assert.equal((yield* ledger.unit.byRoutine("routine")).length, 2);
      assert.equal((yield* ledger.unit.all("different")).length, 0);
    }),
  );
  test(
    "only one concurrent version wins",
    Effect.gen(function* () {
      const { ledger } = yield* fixture;
      const results = yield* Effect.all(
        [ledger.unit.put(contractUnit("same"), 0), ledger.unit.put(contractUnit("same"), 0)],
        { concurrency: 2 },
      );
      assert.equal(results.filter(Boolean).length, 1);
      assert.equal((yield* ledger.unit.get("same"))?.version, 1);
    }),
  );
  test(
    "leases expire and cannot be released or renewed by another holder",
    Effect.gen(function* () {
      const { ledger } = yield* fixture;
      assert.equal(yield* ledger.lease.acquire("calendar", "one", 0, 100), true);
      assert.equal(yield* ledger.lease.acquire("calendar", "two", 99, 100), false);
      assert.equal(yield* ledger.lease.renew("calendar", "two", 99, 100), false);
      yield* ledger.lease.release("calendar", "two");
      assert.equal(yield* ledger.lease.acquire("calendar", "two", 99, 100), false);
      assert.equal(yield* ledger.lease.acquire("calendar", "two", 100, 100), true);
      assert.equal(yield* ledger.lease.renew("calendar", "one", 100, 100), false);
      yield* ledger.lease.release("calendar", "two");
      assert.equal(yield* ledger.lease.acquire("calendar", "one", 100, 100), true);
    }),
  );
  test(
    "cursor and unit versions survive reopen",
    Effect.gen(function* () {
      const opened = yield* fixture;
      yield* opened.ledger.cursor.set("token", "opaque");
      yield* opened.ledger.unit.put(contractUnit("persisted"), 0);
      const reopened = yield* opened.reopen;
      assert.equal(yield* reopened.cursor.get("token"), "opaque");
      assert.equal((yield* reopened.unit.get("persisted"))?.version, 1);
      assert.equal(yield* reopened.unit.put(contractUnit("persisted"), 0), false);
    }),
  );
  test(
    "logs retain only the newest 2000 entries",
    Effect.gen(function* () {
      const { ledger } = yield* fixture;
      for (let at = 0; at < 2003; at++) yield* ledger.log.append({ at, code: "synced", key: null });
      const log = yield* ledger.log.tail(5000);
      assert.equal(log.length, 2000);
      assert.equal(log[0]?.at, 3);
      assert.equal(log.at(-1)?.at, 2002);
      assert.equal((yield* ledger.log.tail(0)).length, 0);
    }),
  );
  test(
    "changes is armed with an initial fingerprint, then news",
    Effect.gen(function* () {
      const { ledger } = yield* fixture;
      const ready = yield* Deferred.make<void>();
      let seen = 0;
      const fiber = yield* ledger.changes.pipe(
        Stream.take(2),
        Stream.tap(() =>
          ++seen === 1 ? Deferred.succeed(ready, undefined).pipe(Effect.asVoid) : Effect.void,
        ),
        Stream.runCollect,
        Effect.forkScoped,
      );
      yield* Deferred.await(ready);
      yield* ledger.cursor.set("change", "value");
      const values = yield* Fiber.join(fiber);
      assert.equal(values.length, 2);
      assert.different(values[0], values[1]);
    }),
  );
}
