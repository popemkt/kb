import { describe, expect, test } from "bun:test";
import { canonicalJsonl, present } from "@kb/model";
import { Effect } from "effect";
import { ACTOR_OPTION_IDS, GOVERNANCE_IDS } from "@kb/governance";
import { STORE_BACKENDS, createStore, bunFileSystemLayer } from "@kb/runtime";
import { openSession } from "../src/store-session.ts";
import { bundledSeed } from "@kb/bundled";
import { CONTRACT_AT, seedGolden, scratchRoot } from "@kb/test-kit";

/*
 * The fresh seed, whole and keyed by id, is the golden byte for byte: moving a
 * family's ids to its own package moves no node, and no parent's children
 * reorder. A deliberate seed change regenerates the file in the same commit.
 */
describe("seed golden", () => {
  test("a fresh store's seed is the golden, children order included", () => {
    expect(canonicalJsonl(bundledSeed(CONTRACT_AT))).toBe(seedGolden());
  });
});

for (const backend of STORE_BACKENDS) {
  test(`${backend}: an older store gains the reaction actor once`, () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const root = yield* scratchRoot;
          yield* createStore(root, backend).pipe(Effect.provide(bunFileSystemLayer));
          const ctx = yield* openSession(root);
          const actorField = present(
            ctx.nodes.find(({ id }) => id === GOVERNANCE_IDS.actorField),
            "actor field",
          );
          yield* ctx.store.commitEffect(
            {
              upserts: [
                {
                  ...actorField,
                  children: actorField.children.filter((id) => id !== ACTOR_OPTION_IDS.reaction),
                },
              ],
              deletes: [ACTOR_OPTION_IDS.reaction],
            },
            { at: CONTRACT_AT },
          );
          const before = ctx.store.txTail.head();
          yield* openSession(root);
          expect(ctx.store.txTail.head()).toBe(before + 1);
          expect(
            ctx.store.txTail
              .entries()
              .at(-1)
              ?.ops.upserts.map(({ id }) => id)
              .toSorted(),
          ).toEqual([ACTOR_OPTION_IDS.reaction, GOVERNANCE_IDS.actorField].toSorted());
          const once = canonicalJsonl(yield* ctx.store.loadEffect);
          yield* openSession(root);
          expect(ctx.store.txTail.head()).toBe(before + 1);
          expect(canonicalJsonl(yield* ctx.store.loadEffect)).toBe(once);
        }),
      ),
    ));
}
