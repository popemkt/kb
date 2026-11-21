/**
 * The store contract's properties about another writer, beside the
 * properties themselves in `store-contract.ts`, which runs them over every
 * adapter.
 */
import { expect } from "bun:test";
import { Effect, Fiber } from "effect";
import { KbStore, onWire, type EffectStore, type KbContext } from "@kb/contracts";
import { present, rankOf, SYSTEM_IDS, type DomainError, type KbNode } from "@kb/model";
import { persistPlannedEffect } from "@kb/operations";
import { IN_PROCESS_WIRE, invokeReceiptEffect, kbRuntimeLayer } from "@kb/runtime";
import {
  backendRoot,
  CONTRACT_AT as AT,
  openSession,
  plainNode,
  scratchRoot,
  type StoreFactory,
} from "./store-session.ts";

/** Land a competing write after the action's plan and before its first commit. */
const raceAction = Effect.fn("storeContract.raceAction")(function* (
  ctx: KbContext,
  action: { id: string; input: unknown },
  competing: Effect.Effect<unknown, DomainError>,
) {
  let attempts = 0;
  const store: EffectStore = {
    ...ctx.store,
    commitEffect: (tx, record, expected) =>
      Effect.gen(function* () {
        attempts += 1;
        if (attempts === 1) yield* competing;
        return yield* ctx.store.commitEffect(tx, record, expected);
      }),
  };
  const receipt = yield* invokeReceiptEffect(ctx, onWire(IN_PROCESS_WIRE, action)).pipe(
    Effect.provideService(KbStore, store),
    Effect.provide(kbRuntimeLayer(ctx)),
  );
  return { receipt, attempts };
});

/** Deleting one child preserves the sibling a concurrent writer just added. */
export function deletePreservesConcurrentSibling(makeStore: StoreFactory): Promise<void> {
  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const root = yield* backendRoot(makeStore);
        const other = yield* Effect.acquireRelease(
          Effect.sync(() => makeStore(root)),
          (store) => store.closeEffect,
        );
        const doomed = plainNode("n-doomed", "remove me");
        const sibling = plainNode("n-sibling", "keep me here");
        const list = parent([doomed.id]);
        yield* other.commitEffect({ upserts: [list, doomed], deletes: [] }, { at: AT });
        const ctx = yield* Effect.acquireRelease(
          openSession(root),
          (session) => session.store.closeEffect,
        );
        const { receipt, attempts } = yield* raceAction(
          ctx,
          { id: "node.delete", input: { id: doomed.id } },
          other.commitEffect(
            { upserts: [parent([doomed.id, sibling.id]), sibling], deletes: [] },
            { at: AT },
          ),
        );
        expect(attempts).toBe(2);
        expect(receipt.status).toBe("succeeded");
        const stored = yield* other.loadEffect;
        expect(stored.some((node) => node.id === doomed.id)).toBe(false);
        expect(stored.find((node) => node.id === list.id)?.children).toEqual([sibling.id]);
      }),
    ),
  );
}

/** Two writers changing distinct fields on one node keep both edits. */
export function updatePreservesConcurrentField(makeStore: StoreFactory): Promise<void> {
  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const root = yield* backendRoot(makeStore);
        const other = yield* Effect.acquireRelease(
          Effect.sync(() => makeStore(root)),
          (store) => store.closeEffect,
        );
        const node = plainNode("n-edit", "a view");
        yield* other.commitEffect({ upserts: [node], deletes: [] }, { at: AT });
        const ctx = yield* Effect.acquireRelease(
          openSession(root),
          (session) => session.store.closeEffect,
        );
        const starting = present(ctx.index.getNode(node.id), "the node being edited");
        const concurrent = {
          [SYSTEM_IDS.viewColwidthField]: [{ t: "str" as const, v: '{"name":180}' }],
        };
        const value = { t: "num" as const, v: 42 };
        const expectedProps = { ...concurrent, [SYSTEM_IDS.viewPagesizeField]: [value] };
        const { receipt, attempts } = yield* raceAction(
          ctx,
          {
            id: "node.update",
            input: { id: node.id, setProps: [{ field: SYSTEM_IDS.viewPagesizeField, value }] },
          },
          other.commitEffect(
            { upserts: [{ ...starting, props: concurrent }], deletes: [] },
            { at: AT },
          ),
        );
        expect(attempts).toBe(2);
        expect(receipt).toMatchObject({
          status: "succeeded",
          output: { node: { props: expectedProps } },
        });
        const stored = yield* other.loadEffect;
        expect(stored.find((candidate) => candidate.id === node.id)?.props).toEqual(expectedProps);
      }),
    ),
  );
}

/** A session keeps replanning a write as other commits land on the same parent. */
export function plannedWriteSurvivesContention(makeStore: StoreFactory): Promise<void> {
  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const root = yield* backendRoot(makeStore);
        const ctx = yield* Effect.acquireRelease(
          openSession(root),
          (session) => session.store.closeEffect,
        );
        const other = yield* Effect.acquireRelease(
          Effect.sync(() => makeStore(root)),
          (store) => store.closeEffect,
        );
        yield* other.commitEffect({ upserts: [parent([])], deletes: [] }, { at: AT });
        const head = other.txTail.entries().length;
        const contenders = Array.from({ length: 6 }, (_, i) => plainNode(`n-other-${i}`, "other"));
        const own = plainNode("n-own", "own");
        let plans = 0;
        const committed = yield* persistPlannedEffect(ctx, (nodes) =>
          Effect.gen(function* () {
            const current = present(
              nodes.find((node) => node.id === "n-p"),
              "the parent",
            );
            // Each contender commits after the plan read the parent and before its conditional write.
            const winner = contenders[plans];
            plans += 1;
            if (winner !== undefined) {
              yield* other.commitEffect(
                { upserts: [parent([...current.children, winner.id]), winner], deletes: [] },
                { at: AT },
              );
            }
            return { upserts: [parent([...current.children, own.id]), own], deletes: [] };
          }),
        ).pipe(Effect.provide(kbRuntimeLayer(ctx)));

        const children = [...contenders.map((node) => node.id), own.id];
        expect(plans).toBe(children.length);
        expect(committed?.upserts[0]?.children).toEqual(children);
        expect(ctx.index.getNode("n-p")?.children).toEqual(children);
        const stored = yield* other.loadEffect;
        expect(stored.find((node) => node.id === "n-p")?.children).toEqual(children);
        expect(other.txTail.entries()).toHaveLength(head + children.length);
      }),
    ),
  );
}

export interface WriteLockHolder {
  /** Resolve the backend's lock API from this directory. */
  readonly cwd: string;
  /** Code that acquires the lock on `path` and keeps it until the process exits. */
  readonly script: string;
}

/** A child owns the backend's real lock. The stdin pipe controls its lifetime. */
const holdLock = Effect.fn("storeContract.holdLock")(function* (
  path: string,
  { cwd, script }: WriteLockHolder,
) {
  const child = yield* Effect.acquireRelease(
    Effect.sync(() =>
      Bun.spawn(
        [
          process.execPath,
          "-e",
          `const path = ${JSON.stringify(path)};
${script}
console.log("locked"); await Bun.stdin.text();`,
        ],
        { cwd, stdin: "pipe", stdout: "pipe", stderr: "inherit" },
      ),
    ),
    (process) =>
      Effect.gen(function* () {
        process.kill();
        yield* Effect.promise(() => process.exited);
      }),
  );
  const reader = child.stdout.getReader();
  const ready = yield* Effect.promise(() => reader.read()).pipe(Effect.timeout("5 seconds"));
  expect(new TextDecoder().decode(ready.value)).toBe("locked\n");
  reader.releaseLock();
  return child;
});

export function opensAndCommitsUnderContention(
  makeStore: StoreFactory,
  holder: WriteLockHolder,
): Promise<void> {
  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const root = yield* scratchRoot;
        const store = yield* Effect.acquireRelease(
          Effect.sync(() => makeStore(root)),
          (opened) => opened.closeEffect,
        );
        yield* store.commitEffect({ upserts: [plainNode("a", "a")], deletes: [] }, { at: AT });
        yield* store.closeEffect;
        const child = yield* holdLock(store.path, holder);

        // A fresh connection reads the last committed state while the child
        // still owns the lock. Only the write should have to wait.
        expect((yield* store.loadEffect).map(({ id }) => id)).toEqual(["a"]);
        const commit = yield* Effect.forkScoped(
          store.commitEffect({ upserts: [plainNode("b", "b")], deletes: [] }, { at: AT }),
          { startImmediately: true },
        );
        const ticker = yield* Effect.forkScoped(Effect.sleep("50 millis"));
        yield* Fiber.join(ticker);
        expect(commit.pollUnsafe()).toBeUndefined();

        yield* Effect.promise(() => Promise.resolve(child.stdin.end()));
        expect(yield* Effect.promise(() => child.exited)).toBe(0);
        yield* Fiber.join(commit);
        expect((yield* store.loadEffect).map(({ id }) => id)).toEqual(["a", "b"]);
      }),
    ),
  );
}

/** The parent every writer below appends under, holding `children`. */
function parent(children: string[]): KbNode {
  return { ...plainNode("n-p", "p"), children };
}

/**
 * A store may keep what it last read or wrote, to merge the next commit into
 * without reading itself again; another writer's commit in between must undo
 * that, on every adapter: the next commit merges into what the other writer
 * left — nothing it added lost, nothing it deleted back — and settles ranks
 * against it.
 */
export function commitAfterAnotherWriterMergesIntoIt(makeStore: StoreFactory): Promise<void> {
  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const root = yield* scratchRoot;
        const one = makeStore(root);
        const two = makeStore(root);
        yield* one.commitEffect(
          { upserts: [parent(["n-a"]), { ...plainNode("n-a", "a"), order: "i" }], deletes: [] },
          { at: AT },
        );
        // Another writer appends under the parent, and its commit ranks the child.
        yield* two.commitEffect(
          { upserts: [parent(["n-a", "n-b"]), plainNode("n-b", "b")], deletes: [] },
          { at: AT },
        );
        // This writer appends too: settled against the other's child, not its own last write.
        yield* one.commitEffect(
          { upserts: [parent(["n-a", "n-b", "n-c"]), plainNode("n-c", "c")], deletes: [] },
          { at: AT },
        );
        const appended = new Map((yield* two.loadEffect).map((n) => [n.id, n]));
        const ranks = ["n-a", "n-b", "n-c"].map((id) => {
          const rank = rankOf(appended.get(id));
          return rank.ranked ? rank.order : "";
        });
        expect(ranks.every((rank, i) => i === 0 || (ranks[i - 1] ?? "") < rank)).toBe(true);

        // The other writer deletes; this writer's next commit does not bring it back.
        yield* two.commitEffect(
          { upserts: [parent(["n-a", "n-b"])], deletes: ["n-c"] },
          { at: AT },
        );
        yield* one.commitEffect(
          { upserts: [{ ...present(appended.get("n-a"), "n-a"), text: "a2" }], deletes: [] },
          { at: AT },
        );
        const left = yield* makeStore(root).loadEffect;
        expect(left.map((n) => n.id)).toEqual(["n-a", "n-b", "n-p"]);
        expect(left.find((n) => n.id === "n-a")?.text).toBe("a2");
      }),
    ),
  );
}

/**
 * A holder of one state can learn what other writers committed since it
 * from the tail alone (`TxTail.committedSince`): every adapter answers the
 * commits in order, as they were applied, without the record of a
 * transaction the store never committed, and ending on the store's current
 * fingerprint; and a state the tail never named answers null.
 */
export function tailNamesCommitsSinceAState(makeStore: StoreFactory): Promise<void> {
  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const root = yield* scratchRoot;
        const one = makeStore(root);
        const two = makeStore(root);
        yield* one.commitEffect({ upserts: [plainNode("n-a", "a")], deletes: [] }, { at: AT });
        const held = present(yield* one.fingerprint, "a fingerprint after a commit");

        const added = yield* two.commitEffect(
          { upserts: [plainNode("n-b", "b")], deletes: [] },
          { at: AT },
        );
        yield* two.txTail.append(
          { upserts: [plainNode("n-v", "virtual")], deletes: [] },
          { at: AT },
        );
        const dropped = yield* two.commitEffect({ upserts: [], deletes: ["n-a"] }, { at: AT });

        expect(one.txTail.committedSince(held)).toEqual({
          txs: [added.tx, dropped.tx],
          mark: present(yield* one.fingerprint, "a fingerprint after a commit"),
        });
        expect(one.txTail.committedSince("never-a-state")).toBeNull();
      }),
    ),
  );
}
