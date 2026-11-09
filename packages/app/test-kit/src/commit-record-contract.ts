/** Commit receipts and their durable attribution, shared by every store contract. */
import { expect } from "bun:test";
import { Effect } from "effect";
import { onWire } from "@kb/contracts";
import { present } from "@kb/model";
import { invokeReceiptEffect, IN_PROCESS_WIRE, kbRuntimeLayer } from "@kb/runtime";
import {
  CONTRACT_AT as AT,
  backendRoot,
  openSession,
  plainNode,
  scratchRoot,
  type StoreFactory,
} from "./store-session.ts";

export function commitReceiptNamesItsWrite(makeStore: StoreFactory): Promise<void> {
  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const root = yield* scratchRoot;
        const one = makeStore(root);
        const two = makeStore(root);
        yield* one.commitEffect(
          { upserts: [plainNode("a", "first"), plainNode("drop", "remove me")], deletes: [] },
          { at: AT },
        );
        // One has kept an older state; its receipt must name what two left,
        // not what one remembers from its earlier commit.
        yield* two.commitEffect(
          { upserts: [plainNode("a", "other writer")], deletes: [] },
          { at: AT },
        );
        const landed = yield* one.commitEffect(
          { upserts: [plainNode("a", "ours"), plainNode("new", "created")], deletes: ["drop"] },
          { at: AT, actor: "cli" },
        );
        const committed = present(landed.record, "expected a nonempty commit record");
        expect(committed.ops).toEqual(landed.tx);
        expect(committed.actor).toBe("cli");
        expect(landed.writes.map(({ before, after }) => [before?.text, after?.text])).toEqual([
          ["other writer", "ours"],
          [undefined, "created"],
          ["remove me", undefined],
        ]);
        yield* two.commitEffect(
          { upserts: [plainNode("later", "later")], deletes: [] },
          { at: AT },
        );
        expect(one.txTail.entries().find(({ rev }) => rev === committed.rev)).toEqual(committed);
        expect(committed.rev).toBeLessThan(one.txTail.head());
        const empty = yield* one.commitEffect({ upserts: [], deletes: [] }, { at: AT });
        expect(empty.record).toBeNull();
        expect(empty.writes).toEqual([]);
      }),
    ),
  );
}

/**
 * Who made a commit, the tab session it was made in and the caller's `via`
 * label are recorded on its tail entry, durably and only when said: a record
 * naming them reads back with them from another store over the same files,
 * one naming none reads back with no key, and a call made through the invoke
 * core records all three without its caller saying more.
 */
export function tailRecordsWhoCommitted(makeStore: StoreFactory): Promise<void> {
  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const root = yield* backendRoot(makeStore);
        const store = makeStore(root);
        yield* store.commitEffect(
          { upserts: [plainNode("n-agent", "a")], deletes: [] },
          { at: AT, actor: "agent", session: "tab.a", via: "job:a" },
        );
        yield* store.commitEffect({ upserts: [plainNode("n-none", "b")], deletes: [] }, { at: AT });
        const reaction = { kind: "reaction", id: "ext.router.route" } as const;
        yield* store.commitEffect(
          { upserts: [plainNode("n-reaction", "reacted")], deletes: [] },
          { at: AT, actor: reaction },
        );
        const [agent, none, reacted] = makeStore(root).txTail.entries().slice(-3);
        expect(reacted?.actor).toEqual(reaction);
        expect(agent?.actor).toBe("agent");
        expect(agent?.session).toBe("tab.a");
        expect(agent?.via).toBe("job:a");
        expect(none !== undefined && ("actor" in none || "session" in none || "via" in none)).toBe(
          false,
        );

        const ctx = yield* openSession(root);
        const made = yield* invokeReceiptEffect(
          ctx,
          onWire(IN_PROCESS_WIRE, {
            id: "node.add",
            input: { id: "n-cli", text: "c" },
            session: "tab.b",
            via: "job:b",
          }),
        ).pipe(Effect.provide(kbRuntimeLayer(ctx)));
        expect(made.status).toBe("succeeded");
        expect(makeStore(root).txTail.entries().at(-1)).toMatchObject({
          actor: "cli",
          session: "tab.b",
          via: "job:b",
        });
      }),
    ),
  );
}
