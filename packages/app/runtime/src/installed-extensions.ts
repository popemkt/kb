import { resolve } from "node:path";
import { lstat } from "node:fs/promises";
import { Effect, Layer, Result } from "effect";
import { FileSystem } from "effect/FileSystem";
import { BUNDLED_DECLARATIONS } from "@kb/bundled";
import {
  EXTENSION_SCOPES,
  ExtensionCompiler,
  ExtensionStorage,
  type ExtensionFailure,
  type ExtensionSelection,
} from "@kb/contracts";
import { extensionStorageLayer, currentData } from "@kb/workspace-fs";
import { domainError } from "@kb/model";
import { readClosures } from "./extension-loader.ts";
import { bunFileSystemLayer } from "./platform.ts";
import { installedExtensionFolder, type ExtensionFolder } from "./extension-folder.ts";

/** One installed-name rule, shared by compilation and lock discovery. */
function installableName(name: string): boolean {
  return !BUNDLED_DECLARATIONS.some((family) => family.name === name);
}

export const extensionCompilerLayer = Layer.succeed(
  ExtensionCompiler,
  ExtensionCompiler.of({
    compile: Effect.fn("extensions.compile")(function* (dir: string, name: string) {
      if (!installableName(name))
        return yield* domainError("invalid_input", `${name} is a bundled extension`);
      const read = yield* readClosures([installedExtensionFolder(dir, "install")]).pipe(
        Effect.provide(bunFileSystemLayer),
      );
      const found = read.closures.find((entry) => entry.name === name);
      if (found === undefined || read.failures.length !== 0)
        return yield* domainError(
          "invalid_input",
          read.failures.map(({ error }) => error).join("; ") || `no extension ${name}`,
        );
      return found.closure.digest;
    }),
  }),
);
interface Selection {
  readonly links: readonly ExtensionFolder[];
  readonly installed: readonly { name: string; entry: ExtensionSelection; origin: string }[];
  readonly failures: readonly ExtensionFailure[];
}
/** A selection snapshot preserves the pre-live-reload process contract; integrity is checked every load. */
const selections = new Map<string, Effect.Effect<Selection>>();
const readSelection = Effect.fn("extensions.selection")(function* (root: string) {
  const storage = yield* ExtensionStorage;
  const data = yield* currentData;
  const links: ExtensionFolder[] = [];
  const installed: Selection["installed"][number][] = [];
  const failures: ExtensionFailure[] = [];
  for (const scope of EXTENSION_SCOPES) {
    const held = yield* storage.read(root, scope).pipe(Effect.result);
    if (Result.isFailure(held)) {
      failures.push({ file: `${scope} extensions lock`, error: held.failure.message });
      continue;
    }
    for (const path of held.success.links) {
      links.push({
        dir: resolve(scope === "user" ? data : root, path),
        origin: `${scope} link`,
        contained: false,
      });
    }
    for (const [name, entry] of Object.entries(held.success.extensions)) {
      if (!installableName(name)) {
        failures.push({ file: name, error: "installed name is a bundled extension" });
        continue;
      }
      installed.push({ name, entry, origin: `${scope} install` });
    }
  }
  return { links, installed, failures };
});
/** No installed/linked module is imported here, including for admission. */
export const installedFolders = Effect.fn("extensions.folders")(function* (root: string) {
  let snapshot = selections.get(root);
  if (snapshot === undefined) {
    const fs = yield* FileSystem;
    snapshot = yield* Effect.cached(
      readSelection(root).pipe(
        Effect.provide(extensionStorageLayer),
        Effect.provideService(FileSystem, fs),
      ),
    );
    selections.set(root, snapshot);
  }
  const selected = yield* snapshot;
  const storage = yield* ExtensionStorage;
  const folders: ExtensionFolder[] = [];
  const failures = [...selected.failures];
  for (const scope of EXTENSION_SCOPES) {
    for (const link of selected.links.filter(({ origin }) => origin === `${scope} link`)) {
      const exists = yield* Effect.tryPromise({
        try: () => lstat(link.dir),
        catch: () => null,
      }).pipe(Effect.orElseSucceed(() => null));
      if (exists === null)
        failures.push({ file: link.dir, error: "linked extension folder is missing" });
      else folders.push(link);
    }
    for (const { name, entry, origin } of selected.installed.filter(
      (item) => item.origin === `${scope} install`,
    )) {
      const tree = yield* storage.tree(name, entry.locked.files).pipe(Effect.result);
      if (Result.isFailure(tree)) failures.push({ file: name, error: tree.failure.message });
      else if (tree.success === null)
        failures.push({ file: name, error: "not fetched; run kb ext install" });
      else folders.push(installedExtensionFolder(tree.success.dir, origin));
    }
  }
  return { folders, failures };
});
export function resetInstalledSelections(): void {
  selections.clear();
}
/** Admission reads every lock afresh, checks present trees, and never follows links to execute code. */
export const validateInstallLocks = Effect.fn("extensions.validateLocks")(function* (root: string) {
  const storage = yield* ExtensionStorage;
  const selected = yield* readSelection(root);
  const failures = [...selected.failures];
  for (const { name, entry } of selected.installed) {
    const tree = yield* storage.tree(name, entry.locked.files).pipe(Effect.result);
    if (Result.isFailure(tree)) failures.push({ file: name, error: tree.failure.message });
  }
  return failures;
});
