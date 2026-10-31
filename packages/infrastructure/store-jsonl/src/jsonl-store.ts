import { Effect, Predicate, Schema, type Stream } from "effect";
import { FileSystem } from "effect/FileSystem";
import { watch } from "node:fs";
import { dirname, join } from "node:path";
import {
  canonicalJson,
  canonicalJsonlOf,
  decodeStoredNode,
  domainError,
  ensureDomainError,
  rankTx,
  StoreState,
  type DomainError,
  type KbNode,
  type NodeId,
  type StoreTx,
} from "@kb/model";
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem";
import { durableReplaceFile } from "./durable-replace.ts";
import {
  fingerprintChanges,
  KeptState,
  staleCommitError,
  type EffectStore,
  type StoreCommit,
  type StoreFingerprint,
  type TxRecord,
} from "@kb/contracts";
import { acquireNodesWriteLockEffect, releaseNodesWriteLock } from "./write-lock.ts";
import { JsonlTxTail, txTailPath } from "./tx-tail.ts";
import { contentMark, storeMark } from "./content-mark.ts";

function mapFsError(err: unknown): DomainError {
  const message =
    Predicate.hasProperty(err, "message") && typeof err.message === "string"
      ? err.message
      : String(err);
  return domainError("internal", message);
}

/** Decode a complete JSONL document without performing filesystem I/O. */
const decodeNodes = Effect.fn("decodeNodes")(function* (body: string, path: string) {
  let lineNo = 0;

  return yield* Effect.try({
    try: () => {
      // Accumulate only after every line validates — fail the whole load on the
      // first bad line (no partial KbNode[] for callers; no file mutation here).
      const nodes: KbNode[] = [];
      const lines = body.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line === undefined || line.trim().length === 0) continue;
        lineNo = i + 1;
        const raw = JSON.parse(line) as unknown;
        nodes.push(decodeStoredNode(raw));
      }
      return nodes;
    },
    catch: (err) => {
      if (Schema.isSchemaError(err)) {
        return domainError("invalid_input", `invalid node at ${path}:${lineNo}: ${err.message}`, {
          path,
          lineNo,
          issue: err.issue,
        });
      }
      return domainError(
        "invalid_input",
        `malformed JSONL at ${path}:${lineNo}: ${err instanceof Error ? err.message : String(err)}`,
        { path, lineNo },
      );
    },
  });
});

/**
 * The store's bytes, the one read both a load and a commit start from. A file
 * that is not there yet is the empty store, the same answer {@link storeMark}
 * gives it.
 */
const readBody = Effect.fn("readBody")(function* (
  path: string,
): Effect.fn.Return<string, DomainError, FileSystem> {
  const fs = yield* FileSystem;
  const exists = yield* fs.exists(path).pipe(Effect.mapError(mapFsError));
  if (!exists) return "";
  return yield* fs.readFileString(path).pipe(Effect.mapError(mapFsError));
}, Effect.provide(BunFileSystem.layer));

/**
 * What this store keeps of the bytes it last read or wrote: the nodes, and
 * each node's line once a commit of this store wrote the file. A file read
 * from disk keeps no lines (null): it may not be canonical, and the first
 * commit writes every line, as every commit once did.
 */
interface Kept {
  readonly state: StoreState;
  readonly lines: Map<NodeId, string> | null;
}

/**
 * JSONL backend: `<root>/.kb/nodes.jsonl`
 * One canonical-JSON node per line, sorted by id.
 *
 * Commits (r4 Stage-0 hardening, format unchanged):
 * - exclusive `.lock` covering load → mutate → replace
 * - durable replace: write+fsync tmp, rotate `.bak`, rename, fsync dir
 *
 * Load is all-or-nothing: any malformed/invalid line fails the Effect with a
 * line-numbered DomainError and returns no nodes — the file is never rewritten
 * by load (compatible with the pre-Schema loader, which threw mid-parse).
 *
 * A commit reads and hashes the file, as it must to know which bytes it
 * merges into. When those are the bytes this store last read or wrote, it
 * merges into what it kept of them (`Kept`) instead of decoding the file
 * again, and serialises only the nodes it writes; any other bytes — another
 * writer's, a hand edit — are decoded as they always were.
 *
 * Effect-native I/O: {@link JsonlStore.loadEffect}/{@link JsonlStore.commitEffect}.
 * The Bun FileSystem is provided here, not asked of callers.
 */
export class JsonlStore implements EffectStore {
  readonly path: string;
  readonly backupPath: string;
  readonly loadEffect: Effect.Effect<KbNode[], DomainError>;
  readonly fingerprint: Effect.Effect<StoreFingerprint | null>;
  /**
   * Sampled on any move in `.kb`; the content hash decides, so the `.lock`,
   * `.bak` and temp file a commit passes through never announce anything.
   */
  readonly changes: Stream.Stream<StoreFingerprint | null>;
  readonly txTail: JsonlTxTail;
  readonly #kept = new KeptState<Kept>();

  constructor(root: string) {
    this.path = join(root, ".kb", "nodes.jsonl");
    this.backupPath = `${this.path}.bak`;
    this.loadEffect = Effect.flatMap(readBody(this.path), (body) =>
      Effect.tap(decodeNodes(body, this.path), (nodes) =>
        Effect.sync(() => {
          this.#kept.keep(contentMark(body), { state: StoreState.of(nodes), lines: null });
        }),
      ),
    );
    this.fingerprint = Effect.sync(() => storeMark(this.path));
    this.changes = fingerprintChanges({
      directories: [dirname(this.path)],
      watch,
      fingerprint: this.fingerprint,
    });
    this.txTail = new JsonlTxTail(this.path, txTailPath(root));
  }

  commitEffect(
    tx: StoreTx,
    record: TxRecord,
    expected?: StoreFingerprint,
  ): Effect.Effect<StoreCommit, DomainError> {
    const path = this.path;
    const backupPath = this.backupPath;
    const txTail = this.txTail;
    const keeping = this.#kept;
    return Effect.scoped(
      Effect.gen(function* () {
        yield* Effect.acquireRelease(acquireNodesWriteLockEffect(path), (lockPath) =>
          Effect.sync(() => releaseNodesWriteLock(lockPath)),
        );

        // Under the lock, and from the one read the merge absorbs: `base` names
        // exactly the file this commit merged into, which is what the caller
        // needs to know it saw.
        const current = yield* readBody(path);
        const base = contentMark(current);
        const stale = staleCommitError(expected, base);
        if (stale !== null) return yield* stale;
        // Taken, not read: whatever fails from here leaves nothing kept, and
        // the next commit reads the file.
        const kept = keeping.take(base) ?? {
          state: StoreState.of(yield* decodeNodes(current, path)),
          lines: null,
        };
        const applied = rankTx(kept.state, tx);
        kept.state.apply(applied);
        const lines = kept.lines ?? linesOf(kept.state.values());
        if (kept.lines !== null) {
          for (const id of applied.deletes) lines.delete(id);
          for (const node of applied.upserts) lines.set(node.id, canonicalJson(node));
        }
        const body = canonicalJsonlOf(lines);
        const fingerprint = contentMark(body);

        yield* Effect.try({
          try: () => durableReplaceFile(path, backupPath, body),
          catch: (err) => ensureDomainError(err),
        });

        // Still under the same lock, so the tail's rev allocation is serialised
        // by the mechanism that already serialises node writes and no second
        // lock is needed. Nodes first, tail second: a tail that lags is
        // detectable (`isCurrent`) and costs one snapshot, while a tail that
        // led would hand replicas a frame for a write that never landed. An
        // empty transaction is not recorded — it costs a rev and a frame and
        // says nothing.
        if (applied.upserts.length > 0 || applied.deletes.length > 0) {
          yield* Effect.try({
            try: () => txTail.append(applied, record, fingerprint),
            catch: (err) => ensureDomainError(err),
          });
        }

        keeping.keep(fingerprint, { state: kept.state, lines });
        return { base, fingerprint, tx: applied };
      }),
    ).pipe(Effect.provide(BunFileSystem.layer));
  }
}

/** Each node's line in the store's file, by id. */
function linesOf(nodes: Iterable<KbNode>): Map<NodeId, string> {
  const lines = new Map<NodeId, string>();
  for (const node of nodes) lines.set(node.id, canonicalJson(node));
  return lines;
}
