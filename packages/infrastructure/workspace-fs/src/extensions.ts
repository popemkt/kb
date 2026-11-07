import { createHash } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { Effect, Layer, Schema } from "effect";
import { FileSystem } from "effect/FileSystem";
import { containedPath } from "./contained.ts";
import {
  SOURCE_LIMITS,
  checkedTree,
  pinnedSchema,
  type ObjectFile,
  type SelectedSource,
} from "@kb/extension-source";
import {
  CachedSourceSchema,
  ExtensionStorage,
  ExtensionLockSchema,
  SourceKindSchema,
  SourceAddressSchema,
  type ExtensionLock,
  type ExtensionScope,
  type CachedTree,
  type SourceAddress,
  type SourceSelection,
  type ExtensionTransaction,
} from "@kb/contracts";
import { domainError, ensureDomainError } from "@kb/model";
import {
  acquireFileWriteLockEffect,
  releaseFileWriteLock,
  durableReplaceFile,
} from "@kb/file-write";
import { currentData } from "./home.ts";

const emptyLock = (): ExtensionLock => ({
  version: 1,
  extensions: {},
  marketplaces: {},
  links: [],
});
const disk = Effect.fn("extensions.disk")(<A>(run: () => Promise<A>) =>
  Effect.tryPromise({ try: run, catch: ensureDomainError }),
);
class MissingExtensionPath extends Schema.TaggedError<MissingExtensionPath>()(
  "Kb/MissingExtensionPath",
  { path: Schema.String },
) {}
const absent = (error: unknown) =>
  error instanceof Error && "code" in error && error.code === "ENOENT";
const fileInfo = Effect.fn("extensions.fileInfo")(function* (file: string) {
  return yield* Effect.tryPromise({
    try: () => lstat(file),
    catch: (error) =>
      absent(error) ? new MissingExtensionPath({ path: file }) : ensureDomainError(error),
  }).pipe(Effect.catchTag("Kb/MissingExtensionPath", () => Effect.succeed(null)));
});
const maybeRead = Effect.fn("extensions.maybeRead")(function* (file: string) {
  return yield* Effect.tryPromise({
    try: () => readFile(file, "utf8"),
    catch: (error) =>
      absent(error) ? new MissingExtensionPath({ path: file }) : ensureDomainError(error),
  }).pipe(Effect.catchTag("Kb/MissingExtensionPath", () => Effect.succeed(null)));
});
/** Walk regular files only. Never follows a symlink, including one replacing the tree root. */
const treeFiles = Effect.fn("extensions.treeFiles")(function* (
  dir: string,
  prefix = "",
): Effect.fn.Return<ObjectFile[], ReturnType<typeof domainError>> {
  const stat = yield* disk(() => lstat(dir));
  if (!stat.isDirectory() || stat.isSymbolicLink())
    return yield* domainError("invalid_input", `tampered extension directory: ${dir}`);
  const files: ObjectFile[] = [];
  for (const name of (yield* disk(() => readdir(dir))).toSorted()) {
    const path = join(dir, name);
    const info = yield* disk(() => lstat(path));
    if (info.isSymbolicLink())
      return yield* domainError("invalid_input", `tampered extension symlink: ${path}`);
    if (info.isDirectory()) files.push(...(yield* treeFiles(path, `${prefix}${name}/`)));
    else if (info.isFile() && info.size <= SOURCE_LIMITS.bytes)
      files.push({
        path: `${prefix}${name}`,
        mode: info.mode & 0o111 ? "100755" : "100644",
        bytes: yield* disk(() => readFile(path)),
      });
    else return yield* domainError("invalid_input", `tampered extension file: ${path}`);
    if (
      files.length > SOURCE_LIMITS.files ||
      files.reduce((size, file) => size + file.bytes.length, 0) > SOURCE_LIMITS.bytes
    )
      return yield* domainError("invalid_input", "extension tree exceeds limits");
  }
  return files;
});
const writable = Effect.fn("extensions.writable")(function* (
  dir: string,
): Effect.fn.Return<void, ReturnType<typeof domainError>> {
  const stat = yield* fileInfo(dir);
  if (stat === null || !stat.isDirectory() || stat.isSymbolicLink()) return;
  yield* disk(() => chmod(dir, 0o700));
  for (const name of yield* disk(() => readdir(dir))) yield* writable(join(dir, name));
});
const sorted = (value: unknown): string =>
  JSON.stringify(
    value,
    (_key, item: unknown) =>
      item !== null && typeof item === "object" && !Array.isArray(item)
        ? Object.fromEntries(Object.entries(item).toSorted(([a], [b]) => (a < b ? -1 : 1)))
        : item,
    2,
  ) + "\n";
const locked = <A, E, R>(path: string, body: Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(
    acquireFileWriteLockEffect(path),
    () => body,
    (lock) => Effect.sync(() => releaseFileWriteLock(lock)),
  );

const lockPath = (data: string, root: string, scope: ExtensionScope) =>
  scope === "user"
    ? join(data, "lock.json")
    : join(root, ".kb", scope === "local" ? "extensions.local.json" : "extensions.lock.json");
const address = (data: string, key: SourceAddress) =>
  join(
    data,
    "store",
    `${key.files.slice(7, 39)}-${key.name}${key.kind === "marketplace" ? ".marketplace" : ""}`,
  );
const pinPath = (data: string, selection: SourceSelection) =>
  join(
    data,
    "refs",
    `${createHash("sha256")
      .update(
        JSON.stringify({
          kind: SourceKindSchema.parse(selection.kind),
          pin: pinnedSchema.parse(selection.pin),
        }),
      )
      .digest("hex")}.json`,
  );
const checkedLock = Effect.fn("extensions.lock.check")(function* (
  root: string,
  scope: ExtensionScope,
  value: unknown,
) {
  const lock = yield* Effect.try({
    try: () => ExtensionLockSchema.parse(value),
    catch: () => domainError("invalid_input", "invalid extension lock schema"),
  });
  if (scope === "store")
    for (const path of lock.links) {
      if (isAbsolute(path) || (yield* containedPath(root, resolve(root, path))) === null)
        return yield* domainError(
          "invalid_input",
          `store extension link must be relative and resolve inside the repository: ${path}`,
        );
    }
  return lock;
});
const readLock = Effect.fn("extensions.lock.read")(function* (
  data: string,
  root: string,
  scope: ExtensionScope,
) {
  const path = lockPath(data, root, scope);
  const text = yield* maybeRead(path);
  if (text === null) return emptyLock();
  const value = yield* Effect.try({
    try: () => JSON.parse(text) as unknown,
    catch: () => domainError("invalid_input", `invalid extension lock: ${path}`),
  });
  return yield* checkedLock(root, scope, value);
});
const updateLock = Effect.fn("extensions.lock.update")(function* (
  data: string,
  root: string,
  scope: ExtensionScope,
  change: (held: ExtensionLock) => ExtensionLock,
) {
  const path = lockPath(data, root, scope);
  yield* locked(
    path,
    Effect.gen(function* () {
      const held = yield* readLock(data, root, scope);
      const changed = yield* Effect.try({ try: () => change(held), catch: ensureDomainError });
      const next = yield* checkedLock(root, scope, changed);
      yield* disk(() => mkdir(dirname(path), { recursive: true }));
      yield* Effect.try({
        try: () => durableReplaceFile({ path, body: sorted(next), mode: 0o600 }),
        catch: ensureDomainError,
      });
      return undefined;
    }),
  );
});
const readTree = Effect.fn("extensions.tree")(function* (data: string, input: SourceAddress) {
  const key = yield* Effect.try({
    try: () => SourceAddressSchema.parse(input),
    catch: () => domainError("invalid_input", "invalid source tree address"),
  });
  const dir = address(data, key);
  if ((yield* fileInfo(dir)) === null) return null;
  const actual = yield* checkedTree(yield* treeFiles(dir)).pipe(
    Effect.mapError((error) =>
      domainError("invalid_input", `tampered source ${key.name}: ${error.message}`),
    ),
  );
  if (actual.hash !== key.files)
    return yield* domainError(
      "invalid_input",
      `tampered source ${key.name}: file-set hash mismatch`,
    );
  return { ...key, dir, ignored: [], source: actual };
});
const cachedSource = Effect.fn("extensions.cached")(function* (
  data: string,
  selection: SourceSelection,
) {
  const text = yield* maybeRead(pinPath(data, selection));
  if (text === null) return null;
  const entry = yield* Effect.try({
    try: () => CachedSourceSchema.parse(JSON.parse(text)),
    catch: ensureDomainError,
  }).pipe(Effect.orElseSucceed(() => null));
  const { pin, kind } = selection;
  if (
    entry === null ||
    entry.kind !== kind ||
    entry.pin.repo !== pin.repo ||
    entry.pin.path !== pin.path ||
    entry.pin.rev !== pin.rev
  )
    return null;
  const held = yield* readTree(data, entry).pipe(Effect.orElseSucceed(() => null));
  return held === null ? null : { ...held, ignored: entry.ignored };
});
/** Copy exclusively into private staging, verify the result, then publish before writing a pin. */
const publishTree = Effect.fn("extensions.publish")(function* (
  data: string,
  source: SelectedSource,
  dir: string,
) {
  yield* disk(() => mkdir(dirname(dir), { recursive: true }));
  yield* disk(() => mkdir(join(data, "tmp"), { recursive: true }));
  // GAP [[01M6RTRFDBKDPS8MKVYR9GS61R]] GC must sweep stages abandoned by a crashed publisher.
  const temp = yield* disk(() => mkdtemp(join(data, "tmp", "tree-")));
  yield* Effect.acquireUseRelease(
    Effect.succeed(temp),
    (stage) =>
      Effect.gen(function* () {
        const directories = new Set<string>([stage]);
        for (const file of source.files) {
          const path = join(stage, ...file.path.split("/"));
          yield* disk(() => mkdir(dirname(path), { recursive: true }));
          yield* disk(() =>
            writeFile(path, file.bytes, {
              flag: "wx",
              mode: file.mode === "100755" ? 0o555 : 0o444,
            }),
          );
          let parent = dirname(path);
          while (parent.startsWith(stage)) {
            directories.add(parent);
            if (parent === stage) break;
            parent = dirname(parent);
          }
        }
        const copied = yield* checkedTree(yield* treeFiles(stage)).pipe(
          Effect.mapError((error) => domainError("invalid_input", error.message)),
        );
        if (copied.hash !== source.hash)
          return yield* domainError("invalid_input", "copied extension file-set hash mismatch");
        for (const folder of [...directories]
          .filter((path) => path !== stage)
          .toSorted((a, b) => b.length - a.length))
          yield* disk(() => chmod(folder, 0o555));
        yield* writable(dir);
        yield* disk(() => rm(dir, { recursive: true, force: true }));
        // Cross-directory rename needs a writable directory root; seal it before publishing the pin.
        yield* disk(() => rename(stage, dir));
        yield* disk(() => chmod(dir, 0o555));
        return undefined;
      }),
    (stage) =>
      Effect.gen(function* () {
        yield* writable(stage).pipe(Effect.orElseSucceed(() => undefined));
        yield* disk(() => rm(stage, { recursive: true, force: true })).pipe(
          Effect.orElseSucceed(() => undefined),
        );
      }),
  );
});
const storeSource = Effect.fn("extensions.store")(function* (
  data: string,
  selection: SourceSelection,
  source: SelectedSource,
) {
  const checked = yield* checkedTree(source.files).pipe(
    Effect.mapError((error) => domainError("invalid_input", error.message)),
  );
  if (checked.hash !== source.hash)
    return yield* domainError("invalid_input", "source file-set hash mismatch");
  const key = yield* Effect.try({
    try: () =>
      SourceAddressSchema.parse({ kind: selection.kind, name: source.name, files: checked.hash }),
    catch: ensureDomainError,
  });
  const dir = address(data, key);
  yield* locked(
    dir,
    Effect.gen(function* () {
      const existing = yield* readTree(data, key).pipe(Effect.orElseSucceed(() => null));
      if (existing === null) yield* publishTree(data, source, dir);
    }),
  );
  const index = pinPath(data, selection);
  yield* disk(() => mkdir(dirname(index), { recursive: true }));
  const record = CachedSourceSchema.parse({
    version: 1,
    ...key,
    pin: selection.pin,
    ignored: source.ignored,
  });
  yield* Effect.try({
    try: () => durableReplaceFile({ path: index, body: sorted(record), mode: 0o600 }),
    catch: ensureDomainError,
  });
  return { ...key, dir, ignored: source.ignored, source: checked } satisfies CachedTree;
});
export const extensionStorageLayer = Layer.effect(
  ExtensionStorage,
  Effect.gen(function* () {
    const data = join(yield* currentData, "extensions");
    const fs = yield* FileSystem;
    const transaction: ExtensionTransaction = {
      update: (root, scope, change) =>
        updateLock(data, root, scope, change).pipe(Effect.provideService(FileSystem, fs)),
      store: storeSource.bind(null, data),
    };
    return ExtensionStorage.of({
      read: (root, scope) =>
        readLock(data, root, scope).pipe(Effect.provideService(FileSystem, fs)),
      tree: readTree.bind(null, data),
      cached: cachedSource.bind(null, data),
      mutate(body) {
        return locked(
          join(data, "mutation"),
          Effect.suspend(() => body(transaction)),
        );
      },
    });
  }),
);
