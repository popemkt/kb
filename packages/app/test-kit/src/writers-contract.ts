/**
 * The store contract's properties about another writer, beside the
 * properties themselves in `store-contract.ts`, which runs them over every
 * adapter.
 */
import { expect } from "bun:test";
import { Effect } from "effect";
import { present, rankOf, type KbNode } from "@kb/model";
import { CONTRACT_AT as AT, plainNode, scratchRoot, type StoreFactory } from "./store-session.ts";

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
