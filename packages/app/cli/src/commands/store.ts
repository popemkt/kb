/** `kb init` and `kb store`: making a root's store, moving it between backends, and its backups. */
import { type Command, CommanderError } from "commander";
import { Effect } from "effect";
import { FileSystem } from "effect/FileSystem";
import { join } from "node:path";
import { onWire } from "@kb/contracts";
import {
  STORE_BACKENDS,
  createStore,
  kbRuntimeLayer,
  migrateStore,
  openKbScoped,
  registerOpenedRoot,
  resolveRootEffect,
  writeErr,
  writeOut,
  type StoreBackend,
} from "@kb/runtime";
import { currentIso, ensureDomainError } from "@kb/model";
import { bundledSeed } from "@kb/bundled";
import {
  persistPlannedEffect,
  storeBackupDef,
  storeBackupsDef,
  storeRestoreDef,
} from "@kb/operations";
import { EXIT_USAGE } from "../arguments.ts";
import {
  ACTION_INVOKE_WIRE,
  EXIT_OK,
  cliAction,
  invokeCliEffect,
  kbAction,
  outputLines,
  report,
} from "../command.ts";
import { exampleSeedNodes, isPristine } from "../example.ts";

/** `--store` / `--to`: one of {@link STORE_BACKENDS}, or a usage failure. */
function parseStoreBackend(value: string, flag: string): StoreBackend {
  const found = STORE_BACKENDS.find((name) => name === value);
  if (found === undefined) {
    throw new CommanderError(
      EXIT_USAGE,
      "commander.invalidArgument",
      `${flag} must be one of ${STORE_BACKENDS.join(", ")} (got ${JSON.stringify(value)})`,
    );
  }
  return found;
}

export function storeCommands(program: Command): void {
  program
    .command("init")
    .description("Initialize .kb/ at --root or cwd")
    .option("--bare", "skip the example content (supertags, fields, query, ontologies)")
    .option(`--store <${STORE_BACKENDS.join("|")}>`, "storage backend", "jsonl")
    .action(
      // Not `kbAction`: init is the one command that runs *before* a session
      // could be opened — it creates the root and picks the store the open
      // will then select. `ext-sdk --write` opens the same way.
      cliAction((globals, [opts]: [{ bare?: boolean; store?: string }]) =>
        Effect.gen(function* () {
          const backend = parseStoreBackend(opts.store ?? "jsonl", "--store");
          const root = yield* resolveRootEffect({ root: globals.root, allowCreate: true });
          const fs = yield* FileSystem;
          yield* fs
            .makeDirectory(join(root, ".kb", "queries"), { recursive: true })
            .pipe(Effect.mapError(ensureDomainError));
          yield* createStore(root, backend);

          const ctx = yield* openKbScoped(root);

          /*
           * Example content lands here rather than in the system seed on
           * purpose: the seed runs on every open and is write-guarded, so
           * demo nodes there would come back after you deleted them and no
           * test fixture could avoid them. Init runs once, by choice, and
           * only fills a store nobody has put anything into yet.
           */
          let examples = 0;
          if (opts.bare !== true) {
            const seed = bundledSeed();
            const written = yield* persistPlannedEffect(ctx, (nodes) =>
              isPristine(nodes, seed)
                ? Effect.map(currentIso, (at) => ({ upserts: exampleSeedNodes(at), deletes: [] }))
                : Effect.succeed(null),
            ).pipe(Effect.provide(kbRuntimeLayer(ctx)));
            examples = written?.upserts.length ?? 0;
          }
          // The root a person makes is one of their locations; not being listed costs the picker only.
          const unlisted = yield* registerOpenedRoot(ctx, ACTION_INVOKE_WIRE).pipe(
            Effect.provide(kbRuntimeLayer(ctx)),
          );
          if (unlisted !== null)
            writeErr(`kb init: this root is not among your locations: ${unlisted}`);

          const msg =
            globals.json === true
              ? JSON.stringify({
                  status: "succeeded",
                  id: "init",
                  output: { root: ctx.root, store: backend, exampleNodes: examples },
                })
              : examples > 0
                ? `initialized ${join(ctx.root, ".kb")} (${backend}) with ${examples} example nodes (ordinary nodes — delete any of them)`
                : `initialized ${join(ctx.root, ".kb")} (${backend})`;
          writeOut(msg);
          return EXIT_OK;
        }),
      ),
    );

  const store = program.command("store").description("Storage backend operations");
  store
    .command("migrate")
    .description(`Move this root's nodes to the other backend and remove the old files`)
    .requiredOption(`--to <${STORE_BACKENDS.join("|")}>`, "target backend")
    .action(
      cliAction((globals, [opts]: [{ to: string }]) =>
        Effect.gen(function* () {
          const target = parseStoreBackend(opts.to, "--to");
          const root = yield* resolveRootEffect({ root: globals.root });
          const result = yield* migrateStore(root, target);
          writeOut(
            globals.json === true
              ? JSON.stringify({ status: "succeeded", id: "store.migrate", output: result })
              : `migrated ${String(result.nodes)} nodes from ${result.from} to ${result.to} (${result.path})`,
          );
          return EXIT_OK;
        }),
      ),
    );

  storeBackupCommands(store);
}

/** One backup as a line: its id, its nodes, where it is, and whether the store is still that state. */
function backupLine(backup: {
  id: string;
  nodes: number;
  path: string;
  current?: boolean;
  pinned?: boolean;
}): string {
  const now = `${backup.current === true ? "  (current)" : ""}${backup.pinned === true ? "  (pinned)" : ""}`;
  return `${backup.id}  ${String(backup.nodes)} nodes  ${backup.path}${now}`;
}

/** `kb store backup | backups | restore`: the `store.*` backup actions (DESIGN.md → Storage → Backups). */
function storeBackupCommands(store: Command): void {
  store
    .command("backup")
    .description(
      "Graph backup on this machine; excludes queries, pages, ui.json, extensions and assets",
    )
    .action(
      kbAction((ctx, globals) =>
        invokeCliEffect(ctx, onWire(ACTION_INVOKE_WIRE, { id: storeBackupDef.id, input: {} })).pipe(
          Effect.map((receipt) =>
            report(
              receipt,
              globals,
              outputLines(storeBackupDef, (out) => [
                `${out.fresh ? "backed up" : "already backed up"}: ${backupLine(out.backup)}`,
                "graph only; excludes queries, pages, ui.json, extensions and .kb/assets",
                ...out.removed.map((old) => `removed ${old.id}`),
              ]),
            ),
          ),
        ),
      ),
    );
  store
    .command("backups")
    .description("This root's graph backups on this machine, newest first")
    .action(
      kbAction((ctx, globals) =>
        invokeCliEffect(
          ctx,
          onWire(ACTION_INVOKE_WIRE, { id: storeBackupsDef.id, input: {} }),
        ).pipe(
          Effect.map((receipt) =>
            report(
              receipt,
              globals,
              outputLines(storeBackupsDef, (out) => [
                ...out.backups.map(backupLine),
                `keeps the newest ${String(out.kept)} (kb set sys.extension.core "backups kept" <n>)`,
              ]),
            ),
          ),
        ),
      ),
    );
  store
    .command("restore")
    .description(
      "Restore a graph backup as one transaction, after a safety graph backup; root files and assets excluded; asks first",
    )
    .argument("<backup>", "the backup's id, as `kb store backups` lists it")
    .action(
      kbAction((ctx, globals, [backup]: [string]) =>
        invokeCliEffect(
          ctx,
          onWire(ACTION_INVOKE_WIRE, { id: storeRestoreDef.id, input: { backup } }),
        ).pipe(
          Effect.map((receipt) =>
            report(
              receipt,
              globals,
              outputLines(storeRestoreDef, (out) => [
                `restored ${out.restored.id}: ${String(out.upserts)} written, ${String(out.deletes)} deleted`,
                `the state it replaced is backup ${out.replaced.id} (kb store restore ${out.replaced.id} undoes this)`,
              ]),
            ),
          ),
        ),
      ),
    );
}
