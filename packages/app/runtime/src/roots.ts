/**
 * The {@link KbRoots} port on this machine's filesystem: the home store is
 * where `currentHome` says, a path is probed by what the directory holds (the store chosen by presence, as opening chooses
 * it), a root is served when `.kb/ui.json` names a server that answers for
 * it (`servingUi`), a session over another root is opened exactly as this
 * process opened its own, and the `kb ui` started for a root runs this
 * process's own kb (`serveRoot`, `selfLaunch`), one start per root at a
 * time (`oneStartPerRoot`), and a root's backups are copies of its store
 * under this machine's data directory (`backups.ts`).
 */
import { resolve } from "node:path";
import { Effect, Layer } from "effect";
import { FileSystem } from "effect/FileSystem";
import { KbRoots, KbStore, uiAddressOf, type KbContext, type RootProbe } from "@kb/contracts";
import { domainError, ensureDomainError, type DomainError, type KbNode } from "@kb/model";
import { persistPlannedEffect } from "@kb/operations";
import { canonicalRoot, currentHome, servingUi } from "@kb/workspace-fs";
import { openKbEffect } from "./open.ts";
import { oneStartPerRoot, selfLaunch, serveRoot } from "./serve.ts";
import { listBackups, takeBackup, useBackup } from "./backups.ts";
import { createStore, storeBackendAt, storeSnapshot } from "./store-selection.ts";

/** The store a new root is made with: the default `kb init` makes. */
const NEW_ROOT_BACKEND = "jsonl";

const probeRoot = Effect.fn("kb.roots.probe")(function* (
  path: string,
): Effect.fn.Return<RootProbe, DomainError, FileSystem> {
  const fs = yield* FileSystem;
  const absolute = resolve(path);
  const there = yield* fs.exists(absolute).pipe(Effect.mapError(ensureDomainError));
  if (!there)
    return { path: absolute, state: { kind: "missing", reason: `nothing at ${absolute}` } };
  const root = yield* canonicalRoot(absolute);
  const info = yield* fs.stat(root).pipe(Effect.mapError(ensureDomainError));
  if (info.type !== "Directory")
    return { path: root, state: { kind: "not-a-store", reason: `${root} is not a directory` } };
  const backend = yield* storeBackendAt(root).pipe(
    Effect.map((found) => ({ found })),
    Effect.catch((err) => Effect.succeed({ conflict: err.message })),
  );
  if ("conflict" in backend)
    return { path: root, state: { kind: "not-a-store", reason: backend.conflict } };
  return backend.found === null
    ? { path: root, state: { kind: "not-a-store", reason: `no kb store under ${root}/.kb` } }
    : { path: root, state: { kind: "store", backend: backend.found } };
});

/** Make `root` a kb root, its directory first; a root that already is one is left alone. */
const createRoot = Effect.fn("kb.roots.create")(function* (
  root: string,
): Effect.fn.Return<void, DomainError, FileSystem> {
  const fs = yield* FileSystem;
  yield* fs.makeDirectory(root, { recursive: true }).pipe(Effect.mapError(ensureDomainError));
  if ((yield* storeBackendAt(root)) !== null) return;
  yield* createStore(root, NEW_ROOT_BACKEND);
});

/**
 * `home`, when it is a session over the home store; refused otherwise, as
 * `writeHome` writes no other root.
 */
const homeOnly = Effect.fn("kb.roots.homeOnly")(function* (
  home: KbContext,
): Effect.fn.Return<KbContext, DomainError, FileSystem> {
  const at = yield* probeRoot(home.root);
  const expected = yield* probeRoot(yield* currentHome);
  if (at.path !== expected.path)
    return yield* domainError(
      "invalid_input",
      `${at.path} is not the home store (${expected.path}); only the home store is written here`,
    );
  return home;
});

export function kbRootsLayer(
  registeredPaths: (nodes: readonly KbNode[]) => readonly string[],
): Layer.Layer<KbRoots, never, FileSystem> {
  return Layer.effect(
    KbRoots,
    Effect.gen(function* () {
      const context = yield* Effect.context<FileSystem>();
      const launch = selfLaunch();
      const serve = oneStartPerRoot((root) =>
        serveRoot(root, launch).pipe(Effect.provide(context)),
      );
      return KbRoots.of({
        home: currentHome,
        registered: Effect.gen(function* () {
          const nodes = yield* storeSnapshot(yield* currentHome);
          return [...new Set(registeredPaths(nodes))];
        }).pipe(Effect.provide(context)),
        probe: (path) => probeRoot(path).pipe(Effect.provide(context)),
        served: (root) =>
          servingUi(root).pipe(
            Effect.map((at) => (at === null ? null : uiAddressOf(at))),
            Effect.provide(context),
          ),
        create: (root) => createRoot(root).pipe(Effect.provide(context)),
        // GAP [[01M39XVZCR684Y1V9FXNDT44D5]]: the store opened here is never
        // released, as no selected store is; a sqlite root keeps its connection.
        open: (root) => openKbEffect(root).pipe(Effect.provide(context)),
        // Core's planned commit, with the system writes the home registry is made of.
        writeHome: (home, plan) =>
          homeOnly(home).pipe(
            Effect.provide(context),
            Effect.andThen((session) =>
              persistPlannedEffect(session, plan, { systemWrites: "system" }).pipe(
                Effect.provideService(KbStore, session.store),
              ),
            ),
          ),
        serve,
        snapshot: (root) => storeSnapshot(root).pipe(Effect.provide(context)),
        backup: (root, { keep }) => takeBackup(root, keep).pipe(Effect.provide(context)),
        useBackup: (backup, use) => useBackup(backup, use).pipe(Effect.provide(context)),
        backups: (root) => listBackups(root).pipe(Effect.provide(context)),
      });
    }),
  );
}
