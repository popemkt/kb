/**
 * The plugin data migration contract (DESIGN.md → Action registry → Plugin
 * data migrations), over a store of every backend, walked through the invoke
 * core as every surface walks it, over a family a host loads from its
 * declaration:
 *
 * - a migration with something to do is pending, and its procedure starts at
 *   the backup; one with nothing to do is not, and has no step left;
 * - the preview needs a backup of the store as it is, records the plan, and
 *   pins that backup until the migration is kept or rolled back;
 * - the apply needs a person's approval and writes only the plan previewed:
 *   a store that plans differently since is refused, and sent back to the
 *   backup;
 * - verify records what is wrong; a failed one leaves the decision open,
 *   recommending roll back, with the problems listed;
 * - keep ends the trial and unpins the backup; roll back needs approval,
 *   restores the backup, and offers the migration again;
 * - a script cannot write the migrations' own ledger.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import {
  KbStore,
  KbRoots,
  declarationPlugin,
  defineExtension,
  onWire,
  type ActionInvocation,
  type HostedFamilies,
  type KbContext,
  type MigrationGraph,
  type ProcedureStatus,
} from "@kb/contracts";
import { SYSTEM_IDS, extensionNodeId, present, migrationRecordId, type KbNode } from "@kb/model";
import { persistEffect } from "@kb/operations";
import { makeKernel } from "@kb/plugin";
import { CONTRACT_AT } from "@kb/test-kit";
import { kbRuntimeLayer } from "../src/layers.ts";
import { openKbEffect } from "../src/open.ts";
import { bunFileSystemLayer } from "../src/platform.ts";
import { IN_PROCESS_WIRE } from "../src/invoke.ts";
import { invokeReceiptEffect } from "../src/registry.ts";
import { STORE_BACKENDS, createStore, type StoreBackend } from "../src/store-selection.ts";

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);

const note = (id: string, text: string): KbNode => ({
  id,
  text,
  props: {},
  children: [],
  createdAt: CONTRACT_AT,
  updatedAt: CONTRACT_AT,
});

const OLD = "old ";

/** `fam.rename` renames every "old x" to "new x"; its check calls a node `n.flag` a problem. */
const family = defineExtension({
  name: "fam",
  label: "Family",
  migrations: [
    {
      id: "rename",
      title: "Rename old to new",
      run: (graph: MigrationGraph) => ({
        upserts: graph.nodes
          .filter((node) => node.text.startsWith(OLD))
          .map((node) => ({
            ...node,
            text: `new ${node.text.slice(OLD.length)}`,
            updatedAt: graph.at,
          })),
        deletes: [],
      }),
      check: (graph: MigrationGraph) =>
        graph.nodeOf("n.flag") === undefined ? [] : ["n.flag should not be there"],
    },
    {
      id: "meddle",
      title: "Write the ledger",
      run: () => ({ upserts: [note(migrationRecordId("fam.rename"), "mine")], deletes: [] }),
    },
  ],
});

const PROCEDURE = "migration.fam.rename";
const APPROVED = { actor: "human", approved: true } as const;

interface Listed {
  id: string;
  state: string | null;
  pending: boolean;
  changes: number;
  problem?: string;
}

function migrationContract(backend: StoreBackend): void {
  describe(`migration contract: a ${backend} store`, () => {
    let scratch = "";
    let session: KbContext | null = null;
    let hosted: HostedFamilies | null = null;

    const ctx = (): KbContext => {
      if (session === null) throw new Error("no session: beforeEach did not run");
      return session;
    };

    const invoke = (
      id: string,
      input: unknown,
      claims: Partial<Pick<ActionInvocation, "actor" | "approved">> = {},
    ) =>
      invokeReceiptEffect(ctx(), onWire(IN_PROCESS_WIRE, { id, input, ...claims })).pipe(
        Effect.provide(kbRuntimeLayer(ctx(), undefined, hosted ?? undefined)),
      );

    const output = (
      id: string,
      input: unknown,
      claims: Partial<Pick<ActionInvocation, "actor" | "approved">> = {},
    ) =>
      invoke(id, input, claims).pipe(
        Effect.map((receipt): unknown => {
          if (receipt.status !== "succeeded")
            throw new Error(`${id} failed: ${receipt.code} ${receipt.message}`);
          return receipt.output;
        }),
      );

    const step = (
      name: string,
      claims: Partial<Pick<ActionInvocation, "actor" | "approved">> = {},
      action?: string,
    ) =>
      invoke(
        "procedure.step",
        { procedure: PROCEDURE, step: name, ...(action === undefined ? {} : { action }) },
        claims,
      );

    const status = () =>
      output("procedure.status", { procedure: PROCEDURE }).pipe(
        Effect.map((out) => out as ProcedureStatus),
      );

    const listed = (id: string) =>
      output("migration.list", {}).pipe(
        Effect.map((out) => (out as { migrations: Listed[] }).migrations.find((m) => m.id === id)),
      );

    const pinned = () =>
      output("store.backups", {}).pipe(
        Effect.map((out) =>
          (out as { backups: { id: string; pinned: boolean }[] }).backups
            .filter((b) => b.pinned)
            .map((b) => b.id),
        ),
      );

    const texts = () =>
      ctx()
        .nodes.filter((node) => node.id.startsWith("n."))
        .map((node) => node.text)
        .toSorted();

    const write = (nodes: KbNode[]) =>
      persistEffect(ctx(), { upserts: nodes, deletes: [] }).pipe(
        Effect.provideService(KbStore, ctx().store),
      );

    /** Back up, preview and apply, the apply approved. */
    const applied = () =>
      Effect.gen(function* () {
        expect((yield* step("backup")).status).toBe("succeeded");
        expect((yield* step("preview")).status).toBe("succeeded");
        expect((yield* step("apply", APPROVED)).status).toBe("succeeded");
      });

    beforeEach(() =>
      run(
        Effect.gen(function* () {
          scratch = yield* Effect.promise(async () =>
            realpath(await mkdtemp(join(tmpdir(), "kb-migration-contract-"))),
          );
          yield* createStore(scratch, backend).pipe(Effect.provide(bunFileSystemLayer));
          session = yield* openKbEffect(scratch).pipe(Effect.provide(bunFileSystemLayer));
          const kernel = makeKernel({ host: "server" });
          yield* kernel.load(declarationPlugin(family));
          hosted = { rows: Effect.succeed([]), kernel };
          yield* write([note("n.a", "old a"), note("n.b", "old b")]);
        }),
      ),
    );

    afterEach(() => {
      session = null;
      hosted = null;
      return rm(scratch, { recursive: true, force: true });
    });

    const keepOne = () =>
      write([
        {
          ...present(
            ctx().nodes.find((n) => n.id === extensionNodeId("core")),
            "core",
          ),
          props: { [SYSTEM_IDS.backupsKeptField]: [{ t: "num", v: 1 }] },
        },
      ]);

    test("a stale second session cannot prune a published rollback pin", () =>
      run(
        Effect.gen(function* () {
          yield* keepOne();
          const stale = yield* openKbEffect(scratch).pipe(Effect.provide(bunFileSystemLayer));
          const first = (yield* output("store.backup", {})) as { backup: { id: string } };
          yield* output("migration.preview", { migration: "fam.rename" });
          const receipt = yield* invokeReceiptEffect(
            stale,
            onWire(IN_PROCESS_WIRE, { id: "store.backup", input: {} }),
          ).pipe(Effect.provide(kbRuntimeLayer(stale)));
          expect(receipt.status).toBe("succeeded");
          expect(yield* pinned()).toContain(first.backup.id);
        }),
      ));

    test("a backup racing preview cannot prune its pin before publication", () =>
      run(
        Effect.gen(function* () {
          yield* keepOne();
          const first = (yield* output("store.backup", {})) as { backup: { id: string } };
          const roots = yield* KbRoots;
          const store = ctx().store;
          const commit = store.commitEffect.bind(store);
          let racing: Promise<unknown> | undefined;
          store.commitEffect = Effect.fn("test.previewPublication")(function* (
            ...[tx, record, expected]: Parameters<typeof store.commitEffect>
          ) {
            if (
              racing === undefined &&
              tx.upserts.some((n) => n.id === migrationRecordId("fam.rename"))
            ) {
              racing = run(roots.backup(scratch, { keep: 1 }));
              yield* Effect.sleep("500 millis");
            }
            return yield* commit(tx, record, expected);
          });
          try {
            yield* output("migration.preview", { migration: "fam.rename" });
            if (racing === undefined) throw new Error("preview did not commit");
            yield* Effect.promise(() => racing ?? Promise.resolve());
            expect(yield* pinned()).toContain(first.backup.id);
          } finally {
            store.commitEffect = commit;
          }
        }).pipe(Effect.provide(kbRuntimeLayer(ctx()))),
      ));

    test("later steps preserve the record's edited label", () =>
      run(
        Effect.gen(function* () {
          yield* applied();
          const record = present(
            ctx().nodes.find((n) => n.id === migrationRecordId("fam.rename")),
            "record",
          );
          yield* write([{ ...record, text: "My trial" }]);
          yield* output("migration.verify", { migration: "fam.rename" });
          yield* output("migration.keep", { migration: "fam.rename" });
          const after = present(
            ctx().nodes.find((n) => n.id === record.id),
            "record",
          );
          expect(after.text).toBe("My trial");
        }),
      ));

    test("a migration with something to do is pending, its procedure at the backup", () =>
      run(
        Effect.gen(function* () {
          expect(yield* listed("fam.rename")).toEqual({
            id: "fam.rename",
            title: "Rename old to new",
            state: null,
            pending: true,
            changes: 2,
          } as Listed);
          const at = yield* status();
          expect(at.steps.map((s) => s.id)).toEqual([
            "backup",
            "preview",
            "apply",
            "verify",
            "decide",
          ]);
          expect(at.current).toBe("backup");
          expect(at.steps.at(-1)?.decision).toBe(true);
        }),
      ));

    test("a migration with nothing to do is not pending, and has no step left", () =>
      run(
        Effect.gen(function* () {
          yield* write([note("n.a", "new a"), note("n.b", "new b")]);
          expect((yield* listed("fam.rename"))?.pending).toBe(false);
          expect((yield* status()).current).toBeNull();
        }),
      ));

    test("the preview needs a backup of the store as it is, and pins it", () =>
      run(
        Effect.gen(function* () {
          const early = yield* invoke("migration.preview", { migration: "fam.rename" });
          expect(early.status === "failed" && early.code).toBe("conflict");
          const backup = (yield* output("store.backup", {})) as { backup: { id: string } };
          const preview = (yield* output("migration.preview", { migration: "fam.rename" })) as {
            backup: string;
            changes: number;
            creates: number;
          };
          expect(preview).toMatchObject({ backup: backup.backup.id, changes: 2, creates: 0 });
          expect(yield* pinned()).toEqual([backup.backup.id]);
          expect(texts()).toEqual(["old a", "old b"]);
          expect((yield* status()).current).toBe("apply");
        }),
      ));

    test("the apply needs approval, and writes only the plan previewed", () =>
      run(
        Effect.gen(function* () {
          yield* step("backup");
          yield* step("preview");
          const refused = yield* step("apply");
          expect(refused.status === "failed" && refused.code).toBe("approval_required");
          expect(texts()).toEqual(["old a", "old b"]);
          // A person's edit since the preview makes the store plan differently.
          yield* write([note("n.c", "old c")]);
          const at = yield* status();
          expect(at.current).toBe("backup");
          expect(at.steps.find((s) => s.id === "preview")?.notes).toEqual([
            "the store plans differently since the preview: back up and preview again",
          ]);
          const stale = yield* invoke("migration.apply", { migration: "fam.rename" }, APPROVED);
          expect(stale.status === "failed" && stale.code).toBe("conflict");
          expect(texts()).toEqual(["old a", "old b", "old c"]);
          yield* applied();
          expect(texts()).toEqual(["new a", "new b", "new c"]);
          expect((yield* status()).current).toBe("verify");
        }),
      ));

    test("verified, the trial ends with keep, which unpins the backup", () =>
      run(
        Effect.gen(function* () {
          yield* applied();
          expect((yield* step("verify")).status).toBe("succeeded");
          const trial = yield* status();
          expect(trial.current).toBe("decide");
          const decide = trial.steps.find((s) => s.id === "decide");
          expect(decide?.recommended).toBeUndefined();
          expect(decide?.notes[0]).toStartWith("on trial:");
          expect(decide?.notes.at(-1)).toBe(
            "nothing has changed since the migration: roll back undoes only it",
          );
          expect((yield* pinned()).length).toBe(1);
          const unnamed = yield* step("decide");
          expect(unnamed.status === "failed" && unnamed.code).toBe("invalid_input");
          expect((yield* step("decide", {}, "keep")).status).toBe("succeeded");
          expect((yield* status()).current).toBeNull();
          expect(yield* pinned()).toEqual([]);
          expect(yield* listed("fam.rename")).toMatchObject({ state: "kept", pending: false });
          expect(texts()).toEqual(["new a", "new b"]);
        }),
      ));

    test("a failed verify recommends roll back, which restores the backup and offers it again", () =>
      run(
        Effect.gen(function* () {
          yield* applied();
          yield* write([note("n.flag", "flag")]);
          const verify = (yield* output("migration.verify", { migration: "fam.rename" })) as {
            state: string;
            problems: string[];
          };
          expect(verify).toMatchObject({
            state: "failed",
            problems: ["n.flag should not be there"],
          });
          const decide = (yield* status()).steps.find((s) => s.id === "decide");
          expect(decide?.recommended).toBe("rollback");
          // The cost of rolling back is said where the choice is made: the edit since is undone, and kept.
          expect(decide?.notes.slice(1, 4)).toEqual([
            "n.flag should not be there",
            expect.stringMatching(/^roll back restores backup .*, taken before the migration$/),
            "1 node(s) changed since the migration: roll back undoes those edits too",
          ]);
          expect(decide?.notes[4]).toStartWith(
            "they are kept in a backup of the store as it is now",
          );
          const safety = (yield* output("store.backup", {})) as { backup: { id: string } };
          const named = (yield* status()).steps.find((s) => s.id === "decide");
          expect(named?.notes[4]).toBe(
            `they are kept in backup ${safety.backup.id}, of the store as it is now`,
          );
          const refused = yield* step("decide", {}, "rollback");
          expect(refused.status === "failed" && refused.code).toBe("approval_required");
          expect(texts()).toEqual(["flag", "new a", "new b"]);
          const rolled = yield* step("decide", APPROVED, "rollback");
          expect(rolled.status === "succeeded" && rolled.output).toMatchObject({
            receipt: { output: { undone: 1, replaced: safety.backup.id } },
          });
          // The store as it was before the migration: the edit made since is in the restore's own backup.
          expect(texts()).toEqual(["old a", "old b"]);
          expect(yield* listed("fam.rename")).toMatchObject({ state: null, pending: true });
          expect((yield* status()).current).toBe("backup");
          expect(yield* pinned()).toEqual([]);
        }),
      ));

    test("a script cannot write the migrations' ledger", () =>
      run(
        Effect.gen(function* () {
          expect((yield* listed("fam.meddle"))?.problem).toContain("ledger");
          yield* output("store.backup", {});
          const meddled = yield* invoke("migration.preview", { migration: "fam.meddle" });
          expect(meddled.status === "failed" && meddled.code).toBe("invalid_input");
          expect(ctx().nodes.some((node) => node.id === migrationRecordId("fam.rename"))).toBe(
            false,
          );
        }),
      ));
  });
}

for (const backend of STORE_BACKENDS) migrationContract(backend);
