/**
 * The backups contract (DESIGN.md → Storage → Backups), over a store of every
 * backend, through the invoke core as every surface runs the actions:
 *
 * - a backup is a root of its own that holds, raw, exactly what the store
 *   held, and names the store's state (its fingerprint) at the copy;
 * - a store already backed up as it is answers that backup, copying nothing;
 * - a machine keeps the newest `backups kept` (core's setting) of a store,
 *   and every backup a node pins (`backup pin`) beside them;
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
import { storeRestoreEffect, persistEffect } from "@kb/operations";
import { currentData } from "@kb/workspace-fs";
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

    test("a late write after the safety copy refuses restore and survives", () =>
      run(
        Effect.gen(function* () {
          const first = yield* backup();
          yield* write([note("n.changed")]);
          const roots = yield* KbRoots;
          const wrapped = {
            ...roots,
            backup: (
              root: string,
              options: { readonly keep: number; readonly pinned: readonly string[] },
            ) => roots.backup(root, options).pipe(Effect.tap(() => write([note("n.late")]))),
          };
          const result = yield* storeRestoreEffect({ backup: first.backup.id }).pipe(
            Effect.provideService(KbRoots, wrapped),
            Effect.result,
          );
          expect(result._tag).toBe("Failure");
          expect((yield* raw(scratch)).some((n) => n.id === "n.late")).toBe(true);
        }).pipe(Effect.provide(kbRuntimeLayer(ctx()))),
      ));

    test("a missing payload is refused and never reused as safety", () =>
      run(
        Effect.gen(function* () {
          const first = yield* backup();
          const before = sorted(yield* raw(scratch));
          yield* Effect.promise(() =>
            rm(join(first.backup.path, ".kb"), { recursive: true, force: true }),
          );
          const receipt = yield* invoke(
            "store.restore",
            { backup: first.backup.id },
            { actor: "human", approved: true },
          );
          expect(receipt.status).toBe("failed");
          expect(sorted(yield* raw(scratch))).toEqual(before);
          expect((yield* backup()).fresh).toBe(true);
        }),
      ));

    test("concurrent backups reserve distinct complete payloads", () =>
      run(
        Effect.gen(function* () {
          const roots = yield* KbRoots;
          const copies = yield* Effect.all(
            Array.from({ length: 4 }, () => roots.backup(scratch, { keep: 20, pinned: [] })),
            { concurrency: "unbounded" },
          );
          expect(new Set(copies.map((copy) => copy.backup.id)).size).toBe(4);
          const expected = sorted(yield* raw(scratch));
          for (const copy of copies)
            expect(sorted(yield* roots.useBackup(copy.backup, Effect.succeed))).toEqual(expected);
        }).pipe(Effect.provide(kbRuntimeLayer(ctx()))),
      ));

    test("concurrent keep-one retains exactly the globally newest copy", () =>
      run(
        Effect.gen(function* () {
          const roots = yield* KbRoots;
          yield* Effect.all(
            Array.from({ length: 4 }, () => roots.backup(scratch, { keep: 1, pinned: [] })),
            { concurrency: "unbounded" },
          );
          const held = yield* roots.backups(scratch);
          expect(held).toHaveLength(1);
          const [newest] = held;
          if (newest === undefined) throw new Error("no backup");
          expect(sorted(yield* roots.useBackup(newest, Effect.succeed))).toEqual(
            sorted(yield* raw(scratch)),
          );
        }).pipe(Effect.provide(kbRuntimeLayer(ctx()))),
      ));

    test("separate processes share keep-one retention", () =>
      run(
        Effect.gen(function* () {
          const data = yield* currentData;
          const backupsModule = new URL("../src/backups.ts", import.meta.url).pathname;
          const platformModule = new URL("../src/platform.ts", import.meta.url).pathname;
          const effectModule = import.meta.resolve("effect");
          const source = `import {Effect} from ${JSON.stringify(effectModule)}; import {takeBackup} from ${JSON.stringify(backupsModule)}; import {bunFileSystemLayer} from ${JSON.stringify(platformModule)}; await Effect.runPromise(takeBackup(${JSON.stringify(scratch)},1).pipe(Effect.provide(bunFileSystemLayer)));`;
          const codes = yield* Effect.promise(async () =>
            Promise.all(
              Array.from({ length: 3 }, async () => {
                const child = Bun.spawn([process.execPath, "-e", source], {
                  env: { ...process.env, KB_DATA: data },
                  stdout: "ignore",
                  stderr: "pipe",
                });
                const [code, error] = await Promise.all([
                  child.exited,
                  new Response(child.stderr).text(),
                ]);
                if (code !== 0) throw new Error(error);
                return code;
              }),
            ),
          );
          expect(codes).toEqual([0, 0, 0]);
          expect((yield* backups()).backups).toHaveLength(1);
        }),
      ));

    test("an empty graph is a valid backup payload", () =>
      run(
        Effect.gen(function* () {
          const empty = join(scratch, "empty");
          yield* createStore(empty, backend).pipe(Effect.provide(bunFileSystemLayer));
          const roots = yield* KbRoots;
          const copied = yield* roots.backup(empty, { keep: 3, pinned: [] });
          expect(yield* roots.useBackup(copied.backup, Effect.succeed)).toEqual([]);
        }).pipe(Effect.provide(kbRuntimeLayer(ctx()))),
      ));

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

    test("a backup a node pins outlives retention, and is listed pinned", () =>
      run(
        Effect.gen(function* () {
          const core = ctx().nodes.find((n) => n.id === extensionNodeId("core"));
          if (core === undefined) throw new Error("no core node");
          yield* write([
            {
              ...core,
              props: { ...core.props, [SYSTEM_IDS.backupsKeptField]: [{ t: "num", v: 1 }] },
            },
          ]);
          const { backup: first } = yield* backup();
          yield* write([
            {
              ...note("n.pin"),
              props: { [SYSTEM_IDS.backupPinField]: [{ t: "str", v: first.id }] },
            },
          ]);
          const second = yield* backup();
          expect(second.removed).toEqual([]);
          yield* write([note("n.more")]);
          const third = yield* backup();
          expect(third.removed.map((b) => b.id)).toEqual([second.backup.id]);
          const listed = (yield* backups()).backups as (Backup & { pinned: boolean })[];
          expect(listed.map((b) => [b.id, b.pinned])).toEqual([
            [third.backup.id, false],
            [first.id, true],
          ]);
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
