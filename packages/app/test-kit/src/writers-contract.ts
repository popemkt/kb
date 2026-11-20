/**
 * The store contract's properties about another writer, beside the
 * properties themselves in `store-contract.ts`, which runs them over every
 * adapter.
 */
import { expect } from "bun:test";
import { Effect } from "effect";
import { present, rankOf, type KbNode } from "@kb/model";
import { persistPlannedEffect } from "@kb/operations";
import { kbRuntimeLayer } from "@kb/runtime";
import {
  backendRoot,
  CONTRACT_AT as AT,
  openSession,
  plainNode,
  scratchRoot,
  type StoreFactory,
} from "./store-session.ts";

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
