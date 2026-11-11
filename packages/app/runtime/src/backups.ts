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
import type { BackupTaken, StoreBackup } from "@kb/contracts";
import { currentIso, domainError, ensureDomainError, type DomainError } from "@kb/model";
import { canonicalRoot, currentData } from "@kb/workspace-fs";
import { copyStore, storeBackendAt } from "./store-selection.ts";

const MANIFEST = "backup.json";

const BackupManifest = Schema.Struct({
  version: Schema.Literal(1),
  root: Schema.String,
  backend: Schema.Literals(["jsonl", "sqlite"]),
  fingerprint: Schema.NullOr(Schema.String),
  nodes: Schema.Finite,
  at: Schema.String,
});
const decodeManifest = Schema.decodeUnknownOption(Schema.fromJsonString(BackupManifest));

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
    found.push({ id, path, root: of, backend, fingerprint, nodes, at });
  }
  return found.toSorted((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id));
});

/** A name for a backup taken at `at` that no backup of the root has yet. */
const freshId = Effect.fn("kb.backups.freshId")(function* (
  dir: string,
  at: string,
): Effect.fn.Return<string, DomainError, FileSystem> {
  const fs = yield* FileSystem;
  const stamp = at.replaceAll(":", "-").replaceAll(".", "-");
  for (let n = 1; ; n++) {
    const id = n === 1 ? stamp : `${stamp}-${String(n)}`;
    if (!(yield* fs.exists(join(dir, id)).pipe(Effect.mapError(ensureDomainError)))) return id;
  }
});

/**
 * Copy `root`'s store into a new backup, then keep only the newest `keep`
 * of its backups that `pinned` does not name (a pinned one is kept beside
 * them). A copy that fails leaves no directory behind.
 */
export const takeBackup = Effect.fn("kb.backups.take")(function* (
  root: string,
  keep: number,
  pinned: readonly string[],
): Effect.fn.Return<BackupTaken, DomainError, FileSystem> {
  const fs = yield* FileSystem;
  const canonical = yield* canonicalRoot(root);
  const backend = yield* storeBackendAt(canonical);
  if (backend === null)
    return yield* domainError("not_found", `no kb store under ${canonical}`, { root: canonical });
  const dir = yield* backupsDir(canonical);
  const at = yield* currentIso;
  const id = yield* freshId(dir, at);
  const path = join(dir, id);
  yield* fs.makeDirectory(path, { recursive: true }).pipe(Effect.mapError(ensureDomainError));
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
    root: canonical,
    backend,
    fingerprint: copied.fingerprint,
    nodes: copied.nodes,
    at,
  };
  // The manifest last: until it is written, the directory is not a backup.
  yield* fs
    .writeFileString(join(path, MANIFEST), `${JSON.stringify(manifest)}\n`)
    .pipe(Effect.mapError(ensureDomainError));
  const kept = new Set(pinned);
  const removed = (yield* listBackups(canonical))
    .filter((held) => held.id !== id && !kept.has(held.id))
    .slice(Math.max(keep, 1) - 1);
  for (const old of removed)
    yield* fs
      .remove(old.path, { recursive: true, force: true })
      .pipe(Effect.mapError(ensureDomainError));
  return { backup, removed };
});
