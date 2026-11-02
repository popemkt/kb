import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Effect } from "effect";
import { SqliteStore } from "@kb/store-sqlite";
import { ledgerContract, SyncError } from "@kb/routines";
import { makeKbLedger } from "@kb/routines-host";

const fixture = Effect.gen(function* () {
  const root = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "routines-ledger-")));
  let store = new SqliteStore(root);
  yield* Effect.addFinalizer(() =>
    Effect.promise(async () => {
      store.close();
      await rm(root, { recursive: true, force: true });
    }),
  );
  const ledger = yield* makeKbLedger(store).pipe(
    Effect.mapError(() => new SyncError({ status: 500, code: "fixture_failed" })),
  );
  return {
    ledger,
    reopen: Effect.suspend(() => {
      store.close();
      store = new SqliteStore(root);
      return makeKbLedger(store);
    }),
  };
});
ledgerContract(
  (name, effect) =>
    test("kb ledger: " + name, () => Effect.runPromise(Effect.scoped(effect)), 120_000),
  fixture,
  { equal: (a, b) => expect(a).toEqual(b), different: (a, b) => expect(a).not.toEqual(b) },
);
test("kb ledger invalidates its decoded snapshot when another connection writes", () =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const root = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "routines-ledger-peers-")));
        const first = new SqliteStore(root);
        const second = new SqliteStore(root);
        yield* Effect.addFinalizer(() =>
          Effect.promise(async () => {
            first.close();
            second.close();
            await rm(root, { recursive: true, force: true });
          }),
        );
        const a = yield* makeKbLedger(first);
        const b = yield* makeKbLedger(second);
        yield* a.cursor.set("token", "before");
        expect(yield* a.cursor.get("token")).toBe("before");
        yield* b.cursor.set("token", "after");
        expect(yield* a.cursor.get("token")).toBe("after");
        expect(yield* a.lease.acquire("calendar", "first", 0, 100)).toBe(true);
        expect(yield* b.lease.acquire("calendar", "second", 1, 100)).toBe(false);
      }),
    ),
  ));
