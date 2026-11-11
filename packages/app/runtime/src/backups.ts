/**
 * Backups of a root's store on this machine (DESIGN.md → Storage → Backups):
 * each a kb root of its own under `<KB_DATA>/backups/<root's key>/<id>`,
 * made by {@link copyStore} in the store's own backend, with a `backup.json`
 * beside its `.kb` naming the root it copied, the source's fingerprint at
 * the copy (the state it is) and when.
 *
 * Per machine and never under the root: a repository's `.kb` is committed,
 * and a backup is a copy of what a person had here, not a revision of it.
 */
import { createHash } from "node:crypto";
import { basename, join } from "node:path";
import { Effect, Option, Schema } from "effect";
import { FileSystem } from "effect/FileSystem";
import { acquireFileWriteLockEffect, releaseFileWriteLock } from "@kb/file-write";
import type { BackupTaken, StoreBackup } from "@kb/contracts";
import {
  canonicalJsonl,
  pinnedBackups,
  type KbNode,
  currentIso,
  domainError,
  ensureDomainError,
  type DomainError,
} from "@kb/model";
import { canonicalRoot, currentData } from "@kb/workspace-fs";
import { copyStore, storeBackendAt, storeSnapshot } from "./store-selection.ts";

// GAP [[01M75ASR5TB03NYPW1G057TTY8]] root text state needs a coordinated restore transaction.
const MANIFEST = "backup.json";

const BackupManifest = Schema.Struct({
  version: Schema.Literal(1),
  digest: Schema.String,
  scope: Schema.Literal("graph"),
  excludes: Schema.Array(Schema.String),
  root: Schema.String,
  backend: Schema.Literals(["jsonl", "sqlite"]),
  fingerprint: Schema.NullOr(Schema.String),
  nodes: Schema.Finite,
  at: Schema.String,
});
const decodeManifest = Schema.decodeUnknownOption(Schema.fromJsonString(BackupManifest));

/** Payload identity is independent of backend fingerprints, which name the source file. */
const graphDigest = (nodes: readonly KbNode[]) =>
  createHash("sha256").update(canonicalJsonl(nodes)).digest("hex");

/** Missing, damaged or replaced payloads are never interpreted as an empty graph. */
const readBackup = Effect.fn("kb.backups.read")(function* (backup: StoreBackup) {
  const fs = yield* FileSystem;
  const manifest = decodeManifest(
    yield* fs.readFileString(join(backup.path, MANIFEST)).pipe(Effect.mapError(ensureDomainError)),
  );
  if (
    Option.isNone(manifest) ||
    manifest.value.root !== backup.root ||
    manifest.value.backend !== backup.backend ||
    (yield* storeBackendAt(backup.path)) !== backup.backend
  )
    return yield* domainError("invalid_input", `backup ${backup.id} has no valid payload`);
  const nodes = yield* storeSnapshot(backup.path);
  if (nodes.length !== manifest.value.nodes || graphDigest(nodes) !== manifest.value.digest)
    return yield* domainError(
      "invalid_input",
      `backup ${backup.id} payload does not match its manifest`,
    );
  return nodes;
});

/**
 * Where `root`'s backups live: its directory's name, for a person reading
 * the folder, and a hash of its canonical path, so two roots of one name
 * never share backups.
 */
const backupsDir = Effect.fn("kb.backups.dir")(function* (
  root: string,
): Effect.fn.Return<string, never, FileSystem> {
  const canonical = yield* canonicalRoot(root);
  const key = createHash("sha256").update(canonical).digest("hex").slice(0, 12);
  return join(yield* currentData, "backups", `${basename(canonical)}-${key}`);
});

/** One root's publication, retention and protected payload uses share a cross-process lock. */
const withBackups = Effect.fn("kb.backups.exclusive")(function* <A, E, R>(
  root: string,
  body: Effect.Effect<A, E, R>,
) {
  const dir = yield* backupsDir(root);
  return yield* Effect.acquireUseRelease(
    acquireFileWriteLockEffect(join(dir, "retention")),
    () => body,
    (lock) => Effect.sync(() => releaseFileWriteLock(lock)),
  );
});

/** Hold the retention boundary through validation and use, not only the payload read. */
export const useBackup = Effect.fn("kb.backups.use")(function* <A, E, R>(
  backup: StoreBackup,
  use: (nodes: readonly KbNode[]) => Effect.Effect<A, E, R>,
) {
  return yield* withBackups(backup.root, readBackup(backup).pipe(Effect.flatMap(use)));
});

/** `root`'s backups, newest first; a directory without a readable manifest is not one. */
export const listBackups = Effect.fn("kb.backups.list")(function* (
  root: string,
): Effect.fn.Return<readonly StoreBackup[], DomainError, FileSystem> {
  const fs = yield* FileSystem;
  const dir = yield* backupsDir(root);
  const names = yield* fs.readDirectory(dir).pipe(Effect.orElseSucceed((): string[] => []));
  const found: StoreBackup[] = [];
  for (const id of names) {
    const path = join(dir, id);
    const text = yield* fs
      .readFileString(join(path, MANIFEST))
      .pipe(Effect.orElseSucceed(() => ""));
    const manifest = decodeManifest(text);
    if (Option.isNone(manifest)) continue;
    const { root: of, backend, fingerprint, nodes, at } = manifest.value;
    const backup = { id, path, root: of, backend, fingerprint, nodes, at };
    const valid = yield* readBackup(backup).pipe(
      Effect.as(true),
      Effect.orElseSucceed(() => false),
    );
    if (valid) found.push(backup);
  }
  return found.toSorted((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id));
});

/**
 * Copy `root`'s store into a new backup, then keep only the newest `keep`
 * of its backups that the current stored graph does not pin (a pinned one is kept beside
 * them). A copy that fails leaves no directory behind.
 */
const copyBackup = Effect.fn("kb.backups.take")(function* (
  root: string,
  keep: number,
): Effect.fn.Return<BackupTaken, DomainError, FileSystem> {
  const fs = yield* FileSystem;
  const canonical = yield* canonicalRoot(root);
  const backend = yield* storeBackendAt(canonical);
  if (backend === null)
    return yield* domainError("not_found", `no kb store under ${canonical}`, { root: canonical });
  const dir = yield* backupsDir(canonical);
  const at = yield* currentIso;
  yield* fs.makeDirectory(dir, { recursive: true }).pipe(Effect.mapError(ensureDomainError));
  const path = yield* fs
    .makeTempDirectory({ directory: dir, prefix: at.replaceAll(":", "-") + "-" })
    .pipe(Effect.mapError(ensureDomainError));
  const id = basename(path);
  const copied = yield* copyStore({ root: canonical, backend }, { root: path, backend }).pipe(
    Effect.tapError(() => fs.remove(path, { recursive: true, force: true }).pipe(Effect.ignore)),
  );
  const backup: StoreBackup = {
    id,
    path,
    root: canonical,
    backend,
    fingerprint: copied.fingerprint,
    nodes: copied.nodes,
    at,
  };
  const manifest: typeof BackupManifest.Type = {
    version: 1,
    scope: "graph",
    excludes: [".kb/queries", ".kb/pages", ".kb/ui.json", ".kb/extensions", ".kb/assets"],
    digest: graphDigest(yield* storeSnapshot(path)),
    root: canonical,
    backend,
    fingerprint: copied.fingerprint,
    nodes: copied.nodes,
    at,
  };
  // The manifest last: until it is written, the directory is not a backup.
  yield* fs
    .writeFileString(join(path, `${MANIFEST}.tmp`), `${JSON.stringify(manifest)}\n`)
    .pipe(Effect.mapError(ensureDomainError));
  yield* fs
    .rename(join(path, `${MANIFEST}.tmp`), join(path, MANIFEST))
    .pipe(Effect.mapError(ensureDomainError));
  const kept = new Set(pinnedBackups(yield* storeSnapshot(canonical)));
  const removed = (yield* listBackups(canonical))
    .filter((held) => !kept.has(held.id))
    .slice(Math.max(keep, 1));
  for (const old of removed)
    yield* fs
      .remove(old.path, { recursive: true, force: true })
      .pipe(Effect.mapError(ensureDomainError));
  return { backup, removed };
});

/** Publish and prune in one serialized operation, including across processes. */
export const takeBackup = Effect.fn("kb.backups.take")(function* (root: string, keep: number) {
  return yield* withBackups(root, copyBackup(root, keep));
});
