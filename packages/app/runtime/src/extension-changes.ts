/** Proactive runtime change signals; ordinary calls use the same lock fingerprint. */
import { statSync, watch } from "node:fs";
import { dirname, relative } from "node:path";
import { Effect, Layer, Stream } from "effect";
import { FileSystem } from "effect/FileSystem";
import { CodeTrust, ExtensionStorage, directorySignals } from "@kb/contracts";
import { codeTrustLayer, extensionStorageLayer } from "@kb/workspace-fs";
import { ownExtensionFolder } from "./extension-folder.ts";
import { invalidateRootExtensions } from "./extension-state.ts";

export function extensionRuntimeChanges(root: string) {
  return Stream.unwrap(
    Effect.gen(function* () {
      const storage = yield* ExtensionStorage;
      const trust = yield* CodeTrust;
      return Stream.merge(storage.changes(root), trust.changes).pipe(Stream.debounce("20 millis"));
    }),
  ).pipe(Stream.provide(Layer.merge(extensionStorageLayer, codeTrustLayer())));
}

/** The root's own extension folder as `root` names it, the way a person reads it. */
export function ownExtensionPath(root: string): string {
  return relative(root, ownExtensionFolder(root).dir);
}

/**
 * The root's own extensions as they are edited (DESIGN.md → Watching the
 * root's own extensions): a tick once the watch is armed, then one after
 * each burst of edits anywhere under `.kb/extensions/`, each once the root's
 * reading is dropped, so the next read sees the files as they are and a
 * saved file is a new digest that is not yet trusted. The folder is created
 * when it is missing, since a folder that is not there cannot be watched.
 * The first tick drops the reading too, so what was edited before watching
 * began is seen as well.
 */
export function ownExtensionEdits(root: string): Stream.Stream<void, never, FileSystem> {
  const dir = ownExtensionFolder(root).dir;
  return Stream.unwrap(
    Effect.gen(function* () {
      const fs = yield* FileSystem;
      yield* fs.makeDirectory(dir, { recursive: true }).pipe(Effect.ignore);
      // The parent owns the directory entry's lifetime; its inode decides
      // whether to re-arm, so unrelated parent traffic does not reload code.
      return directorySignals([dirname(dir)], watch).pipe(
        Stream.mapEffect(() =>
          Effect.sync(() => {
            try {
              const state = statSync(dir, { bigint: true });
              return `${state.dev}:${state.ino}:${state.birthtimeNs}`;
            } catch {
              return null;
            }
          }),
        ),
        Stream.changes,
        Stream.switchMap((inode) =>
          inode === null
            ? Stream.succeed(undefined)
            : directorySignals([dir], (folder, listener) =>
                watch(folder, { recursive: true }, listener),
              ),
        ),
      );
    }),
  ).pipe(
    Stream.debounce("50 millis"),
    Stream.tap(() => Effect.sync(() => invalidateRootExtensions(root))),
  );
}
