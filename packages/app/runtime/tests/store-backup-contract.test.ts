/**
 * The backups contract (DESIGN.md → Storage → Backups), over a store of every
 * backend, through the invoke core as every surface runs the actions:
 *
 * - a backup is a root of its own that holds, raw, exactly what the store
 *   held, and names the store's state (its fingerprint) at the copy;
 * - a store already backed up as it is answers that backup, copying nothing;
 * - a machine keeps the newest `backups kept` (core's setting) of a store;
 * - a restore needs a person's approval, puts the backup's state back as one
 *   transaction, and backs up the state it replaces first, so restoring that
 *   backup undoes it.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { KbRoots, KbStore, onWire, type ActionInvocation, type KbContext } from "@kb/contracts";
import { SYSTEM_IDS, extensionNodeId, type KbNode } from "@kb/model";
import { persistEffect } from "@kb/operations";
import { CONTRACT_AT } from "@kb/test-kit";
import { kbRuntimeLayer } from "../src/layers.ts";
import { openKbEffect } from "../src/open.ts";
import { bunFileSystemLayer } from "../src/platform.ts";
import { IN_PROCESS_WIRE } from "../src/invoke.ts";
import { invokeReceiptEffect } from "../src/registry.ts";
import { STORE_BACKENDS, createStore, type StoreBackend } from "../src/store-selection.ts";

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);

const note = (id: string, text = id): KbNode => ({
  id,
  text,
  props: {},
  children: [],
  createdAt: CONTRACT_AT,
  updatedAt: CONTRACT_AT,
});

/** Nodes as comparable strings, in one order. */
const sorted = (nodes: readonly KbNode[]) => nodes.map((n) => JSON.stringify(n)).toSorted();

interface Backup {
  id: string;
  path: string;
  fingerprint: string | null;
  current?: boolean;
}

function backupsContract(backend: StoreBackend): void {
  describe(`backups contract: a ${backend} store`, () => {
    let scratch = "";
    let session: KbContext | null = null;

    const ctx = (): KbContext => {
      if (session === null) throw new Error("no session: beforeEach did not run");
      return session;
    };

    const invoke = Effect.fn("backupsContract.invoke")(function* (
      id: string,
      input: unknown,
      claims: Partial<Pick<ActionInvocation, "actor" | "approved">> = {},
    ) {
      const at = ctx();
      return yield* invokeReceiptEffect(at, onWire(IN_PROCESS_WIRE, { id, input, ...claims })).pipe(
        Effect.provide(kbRuntimeLayer(at)),
      );
    });

    const output = Effect.fn("backupsContract.output")(function* (
      id: string,
      input: unknown = {},
      claims: Partial<Pick<ActionInvocation, "actor" | "approved">> = {},
    ) {
      const receipt = yield* invoke(id, input, claims);
      if (receipt.status !== "succeeded")
        throw new Error(`${id} failed: ${receipt.code} ${receipt.message}`);
      return receipt.output;
    });

    const write = (upserts: KbNode[], deletes: string[] = []) =>
      persistEffect(ctx(), { upserts, deletes }, { systemWrites: "system" }).pipe(
        Effect.provideService(KbStore, ctx().store),
      );

    const raw = (root: string) =>
      Effect.gen(function* () {
        return yield* (yield* KbRoots).snapshot(root);
      }).pipe(Effect.provide(kbRuntimeLayer(ctx())));

    const fingerprint = () => ctx().store.fingerprint;

    const backup = () =>
      output("store.backup").pipe(
        Effect.map((out) => out as { backup: Backup; fresh: boolean; removed: Backup[] }),
      );
    const backups = () =>
      output("store.backups").pipe(Effect.map((out) => out as { backups: Backup[]; kept: number }));
    /** Restore `id`, approved as a person approves it. */
    const restore = (id: string) =>
      output("store.restore", { backup: id }, { actor: "human", approved: true }).pipe(
        Effect.map((out) => out as { replaced: Backup; upserts: number; deletes: number }),
      );

    beforeEach(() =>
      run(
        Effect.gen(function* () {
          scratch = yield* Effect.promise(async () =>
            realpath(await mkdtemp(join(tmpdir(), "kb-backups-contract-"))),
          );
          yield* createStore(scratch, backend).pipe(Effect.provide(bunFileSystemLayer));
          session = yield* openKbEffect(scratch).pipe(Effect.provide(bunFileSystemLayer));
          yield* write([note("n.a"), note("n.b")]);
        }),
      ),
    );

    afterEach(() => {
      session = null;
      return rm(scratch, { recursive: true, force: true });
    });

    test("a backup is a root holding exactly what the store held, named by its state", () =>
      run(
        Effect.gen(function* () {
          const taken = yield* backup();
          expect(taken.fresh).toBe(true);
          expect(taken.backup.path.startsWith(scratch)).toBe(false);
          expect(sorted(yield* raw(taken.backup.path))).toEqual(sorted(yield* raw(scratch)));
          expect(taken.backup.fingerprint).toBe(yield* fingerprint());
          const listed = yield* backups();
          expect(listed.backups.map((b) => [b.id, b.current])).toEqual([[taken.backup.id, true]]);
        }),
      ));

    test("a store already backed up as it is answers that backup, and a write needs a new one", () =>
      run(
        Effect.gen(function* () {
          const first = yield* backup();
          const again = yield* backup();
          expect(again.fresh).toBe(false);
          expect(again.backup.id).toBe(first.backup.id);
          yield* write([note("n.c")]);
          expect((yield* backups()).backups.map((b) => b.current)).toEqual([false]);
          const next = yield* backup();
          expect(next.fresh).toBe(true);
          expect((yield* backups()).backups.map((b) => [b.id, b.current])).toEqual([
            [next.backup.id, true],
            [first.backup.id, false],
          ]);
        }),
      ));

    test("a machine keeps the newest `backups kept` of a store", () =>
      run(
        Effect.gen(function* () {
          const core = ctx().nodes.find((n) => n.id === extensionNodeId("core"));
          if (core === undefined) throw new Error("no core node");
          yield* write([
            {
              ...core,
              props: { ...core.props, [SYSTEM_IDS.backupsKeptField]: [{ t: "num", v: 2 }] },
            },
          ]);
          expect((yield* backups()).kept).toBe(2);
          const taken: { backup: Backup; removed: Backup[] }[] = [];
          for (const id of ["n.x", "n.y", "n.z"]) {
            yield* write([note(id)]);
            taken.push(yield* backup());
          }
          const ids = taken.map((t) => t.backup.id);
          // The third removes the first; the newest two are what is left.
          expect(taken.map((t) => t.removed.map((b) => b.id))).toEqual([[], [], ids.slice(0, 1)]);
          expect((yield* backups()).backups.map((b) => b.id)).toEqual(ids.slice(1).toReversed());
        }),
      ));

    test("a restore needs approval, lands as one transaction, and is undone by the backup it took", () =>
      run(
        Effect.gen(function* () {
          const held = sorted(yield* raw(scratch));
          const { backup: before } = yield* backup();
          yield* write([note("n.later"), note("n.a", "changed")], ["n.b"]);
          const changed = sorted(yield* raw(scratch));

          const refused = yield* invoke("store.restore", { backup: before.id });
          expect(refused.status).toBe("failed");
          if (refused.status === "failed") expect(refused.code).toBe("approval_required");
          expect(sorted(yield* raw(scratch))).toEqual(changed);

          const revs = ctx().store.txTail.entries().length;
          const restored = yield* restore(before.id);
          expect(sorted(yield* raw(scratch))).toEqual(held);
          expect(ctx().store.txTail.entries().length).toBe(revs + 1);
          expect([restored.upserts, restored.deletes]).toEqual([2, 1]);
          expect(sorted(yield* raw(restored.replaced.path))).toEqual(changed);

          yield* restore(restored.replaced.id);
          expect(sorted(yield* raw(scratch))).toEqual(changed);
        }),
      ));

    test("restoring a backup this store does not have fails and writes nothing", () =>
      run(
        Effect.gen(function* () {
          const held = sorted(yield* raw(scratch));
          const receipt = yield* invoke(
            "store.restore",
            { backup: "2000-01-01T00-00-00-000Z" },
            { actor: "human", approved: true },
          );
          expect(receipt.status).toBe("failed");
          if (receipt.status === "failed") expect(receipt.code).toBe("not_found");
          expect(sorted(yield* raw(scratch))).toEqual(held);
        }),
      ));
  });
}

for (const backend of STORE_BACKENDS) backupsContract(backend);
