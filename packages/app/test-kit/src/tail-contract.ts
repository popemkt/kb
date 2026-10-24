/**
 * The tail contract: what every {@link TxTail} records and reads, whoever owns
 * it — the two stores' durable tails and the {@link MemoryTxTail} a store
 * without a file has. Written over a tail factory, unlike `logContract`, which
 * needs a store to observe a reopen: these properties are the record's own
 * (every field a caller states reads back) and the read past a rev (paged by
 * `pageLength`, the one statement of the rule).
 */
import { describe, expect, test } from "bun:test";
import { Effect, type Scope } from "effect";
import type { TxTail } from "@kb/contracts";
import type { KbNode, StoreTx } from "@kb/model";

const AT = "2026-01-01T00:00:00.000Z";

function upsert(id: string, text: string): StoreTx {
  const node: KbNode = { id, text, props: {}, children: [], createdAt: AT, updatedAt: AT };
  return { upserts: [node], deletes: [] };
}

/** A fresh, empty tail per property, its scratch space released with the scope. */
export type TailFactory = Effect.Effect<TxTail, never, Scope.Scope>;

const PROPERTIES: ReadonlyArray<readonly [string, (tail: TxTail) => void]> = [
  [
    "a record keeps every field its caller stated, and only those",
    (tail) => {
      tail.append(upsert("n-a", "a"), {
        at: AT,
        origin: "client-a",
        actor: "agent",
        session: "tab.a",
        via: "job:a",
      });
      tail.append(upsert("n-b", "b"), { at: AT });
      const [full, bare] = tail.entries();
      expect(full).toMatchObject({ rev: 1, at: AT, origin: "client-a", actor: "agent" });
      expect(full).toMatchObject({ session: "tab.a", via: "job:a" });
      expect(Object.keys(bare ?? {}).toSorted()).toEqual(["at", "ops", "rev"]);
    },
  ],
  [
    "`since` reads the records after a rev, oldest first, all of them without a page",
    (tail) => {
      for (const id of ["a", "b", "c"]) tail.append(upsert(`n-${id}`, id), { at: AT });
      expect(tail.since(1).map((tx) => tx.rev)).toEqual([2, 3]);
      expect(tail.since(3)).toEqual([]);
      expect(tail.since(0)).toEqual(tail.entries());
    },
  ],
  [
    "a page takes at most `limit`, within `maxBytes`, and never fewer than one",
    (tail) => {
      tail.append(upsert("n-a", "a"), { at: AT });
      tail.append(upsert("n-big", "x".repeat(4096)), { at: AT });
      tail.append(upsert("n-c", "c"), { at: AT });
      expect(tail.since(0, { limit: 2, maxBytes: 1 << 20 }).map((tx) => tx.rev)).toEqual([1, 2]);
      // The big record does not fit after the first: the page stops before it.
      expect(tail.since(0, { limit: 10, maxBytes: 1024 }).map((tx) => tx.rev)).toEqual([1]);
      // Alone it is still read, so a reader paging past it moves.
      expect(tail.since(1, { limit: 10, maxBytes: 1024 }).map((tx) => tx.rev)).toEqual([2]);
      expect(tail.since(3, { limit: 10, maxBytes: 1024 })).toEqual([]);
    },
  ],
];

/** Run the tail contract against one tail implementation. */
export function tailContract(name: string, makeTail: TailFactory): void {
  describe(`${name} — TxTail contract`, () => {
    for (const [title, property] of PROPERTIES) {
      test(title, () =>
        Effect.runPromise(
          Effect.scoped(
            Effect.gen(function* () {
              property(yield* makeTail);
            }),
          ),
        ),
      );
    }
  });
}
