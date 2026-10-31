import type { Database } from "bun:sqlite";
import { watch } from "node:fs";
import { dirname } from "node:path";
import { Effect, Predicate, type Stream } from "effect";
import {
  canonicalJson,
  decodeStoredNode,
  domainError,
  isDomainError,
  rankTx,
  StoreState,
  type DomainError,
  type KbNode,
  type StoreTx,
} from "@kb/model";
import {
  fingerprintChanges,
  KeptState,
  staleCommitError,
  type EffectStore,
  type StoreCommit,
  type StoreFingerprint,
  type TxRecord,
} from "@kb/contracts";
import { commitMark, sqliteConnection, type SqliteConnection } from "./connection.ts";
import { sqliteStorePath } from "./paths.ts";
import { SqliteTxTail } from "./tx-tail.ts";

interface NodeRow {
  id: string;
  body: string;
}

/** The `code` of a thrown sqlite/fs error, when it carries one. */
function errnoCode(err: unknown): string {
  return Predicate.hasProperty(err, "code") && typeof err.code === "string" ? err.code : "";
}

/**
 * A write that lost a race is a `conflict`, everything else is `internal` —
 * the same two answers `@kb/store-jsonl` gives, so a caller handling a
 * contended commit does not have to know which adapter it got.
 */
function mapCommitError(err: unknown, path: string): DomainError {
  const code = errnoCode(err);
  const message = err instanceof Error ? err.message : String(err);
  if (code === "SQLITE_BUSY" || code === "SQLITE_LOCKED") {
    return domainError("conflict", `store busy: ${message}`, { path, code });
  }
  return domainError("internal", `commit ${path}: ${message}`, { path });
}

/**
 * SQLite backend: `<root>/.kb/kb.sqlite`.
 *
 * A row per node — `id` primary key, `body` the same `canonicalJson(node)` the
 * JSONL adapter writes — plus a `meta` table holding `schema_version` and
 * `rev`, a counter this store bumps inside every commit. Not a column per
 * field: a node's bytes are what the store promises to give back, and DDL that
 * mirrored the node schema would be a second, partial copy of it.
 *
 * Commits are one `BEGIN IMMEDIATE … COMMIT` covering deletes, upserts and the
 * `rev` bump. There is no `.lock` file: sqlite's own write lock already is one,
 * and a second mechanism beside it would be the one that lies.
 *
 * Load is all-or-nothing like JSONL's: one undecodable row fails the whole
 * load, naming that row's id, and nothing is rewritten.
 *
 * The state this store last read or wrote is kept under its `rev`
 * (`KeptState`), so a commit that lands on that state settles its ranks
 * without decoding every row; another writer moves `rev`, and the commit
 * reads the rows as it always did.
 */
export class SqliteStore implements EffectStore {
  readonly path: string;
  readonly loadEffect: Effect.Effect<KbNode[], DomainError>;
  readonly fingerprint: Effect.Effect<StoreFingerprint | null>;
  /** Sampled on any move in the database's directory; `meta.rev` decides. */
  readonly changes: Stream.Stream<StoreFingerprint | null>;
  readonly txTail: SqliteTxTail;
  private readonly connection: SqliteConnection;
  private readonly kept = new KeptState<StoreState>();

  constructor(root: string) {
    this.path = sqliteStorePath(root);
    this.connection = sqliteConnection(this.path);
    this.loadEffect = loadNodes(this.connection, this.path, this.kept);
    this.fingerprint = fingerprintOf(this.connection);
    this.changes = fingerprintChanges({
      directories: [dirname(this.path)],
      watch,
      fingerprint: this.fingerprint,
    });
    this.txTail = new SqliteTxTail(this.connection, this.path);
  }

  commitEffect(
    tx: StoreTx,
    record: TxRecord,
    expected?: StoreFingerprint,
  ): Effect.Effect<StoreCommit, DomainError> {
    const connection = this.connection;
    const path = this.path;
    const fingerprint = this.fingerprint;
    const txTail = this.txTail;
    const kept = this.kept;
    return Effect.gen(function* () {
      const { base, applied } = yield* commitTx(
        connection,
        path,
        { tx, record, expected },
        txTail,
        kept,
      );
      return { base, fingerprint: yield* fingerprint, tx: applied };
    });
  }

  /** Release the connection. For tests and for `store.migrate`'s teardown. */
  close(): void {
    this.connection.close();
  }
}

interface CommitRequest {
  readonly tx: StoreTx;
  readonly record: TxRecord;
  readonly expected: StoreFingerprint | undefined;
}

/**
 * Run one commit and return the fingerprint it merged into, with the
 * transaction as applied. Read inside the immediate transaction, after
 * sqlite's write lock is taken, so `base` is the state the writes below land
 * on, a conditional commit is checked against exactly that, and the ranks
 * `rankTx` settles are settled against it too.
 */
function commitTx(
  connection: SqliteConnection,
  path: string,
  { tx, record, expected }: CommitRequest,
  txTail: SqliteTxTail,
  kept: KeptState<StoreState>,
): Effect.Effect<{ base: StoreFingerprint | null; applied: StoreTx }, DomainError> {
  return Effect.try({
    try: () => {
      const db = connection.open();
      const drop = db.prepare<unknown, [string]>("DELETE FROM nodes WHERE id = ?");
      const upsert = db.prepare<unknown, [string, string]>(
        `INSERT INTO nodes (id, body) VALUES (?, ?)
           ON CONFLICT(id) DO UPDATE SET body = excluded.body`,
      );
      const committed = db
        .transaction(() => {
          const base = commitMark(db);
          const stale = staleCommitError(expected, base);
          // Thrown to roll the transaction back; `catch` below passes it through.
          if (stale !== null) throw stale;
          // Taken, not read: a commit that fails leaves nothing kept.
          const state =
            kept.take(base) ??
            (tx.upserts.length === 0 ? null : StoreState.of(storedNodes(db, path)));
          const applied = state === null ? tx : rankTx(state, tx);
          for (const id of applied.deletes) drop.run(id);
          for (const node of applied.upserts) upsert.run(node.id, canonicalJson(node));
          // After the rows, whose triggers have moved `rev`, so the mark the
          // tail stamps is the one a reopen will read; inside the same
          // transaction, so on this backend the node rows and their log entry
          // are one act with no crash window between them. An empty
          // transaction is not recorded: it changes nothing and says nothing.
          if (applied.upserts.length > 0 || applied.deletes.length > 0) {
            txTail.appendWithin(db, applied, record);
          }
          // Read under the write lock, after the triggers: the state this
          // commit leaves is the one a reopen will name.
          return { base, applied, state, after: commitMark(db) };
        })
        .immediate();
      if (committed.state !== null && committed.after !== null) {
        committed.state.apply(committed.applied);
        kept.keep(committed.after, committed.state);
      }
      return { base: committed.base, applied: committed.applied };
    },
    catch: (err) => (isDomainError(err) ? err : mapCommitError(err, path)),
  });
}

/**
 * `meta.rev`, the count of row changes the database's own triggers keep. It
 * moves for every writer, a hand-run `sqlite3` included, and on every commit
 * that touches a row — even one whose content is byte-identical to what was
 * there, where JSONL's content hash deliberately does not. And it is the
 * database's, not the connection's, so every reader names one state alike.
 * Null when the file does not exist, and null compares equal to nothing.
 */
function fingerprintOf(connection: SqliteConnection): Effect.Effect<StoreFingerprint | null> {
  return Effect.sync(() => {
    try {
      const db = connection.peek();
      return db === null ? null : commitMark(db);
    } catch {
      // The port promises no failure here; a store that cannot say says null.
      return null;
    }
  });
}

function loadNodes(
  connection: SqliteConnection,
  path: string,
  kept: KeptState<StoreState>,
): Effect.Effect<KbNode[], DomainError> {
  return Effect.suspend(() =>
    Effect.try({
      try: () => {
        const db = connection.peek();
        if (db === null) return [];
        // The mark first: a write landing between it and the rows leaves rows
        // newer than the mark, which the next commit sees as another state
        // and reads again — never the other way round.
        const mark = commitMark(db);
        const nodes = storedNodes(db, path);
        if (mark !== null) kept.keep(mark, StoreState.of(nodes));
        return nodes;
      },
      catch: (err) =>
        isDomainError(err)
          ? err
          : domainError("internal", err instanceof Error ? err.message : String(err)),
    }),
  );
}

/**
 * Every row, decoded. One bad row throws a DomainError naming it, so no caller
 * ever sees a partial KbNode[]. The load and the commit's rank settling read
 * the rows through this one decoder.
 */
function storedNodes(db: Database, path: string): KbNode[] {
  const rows = db.query<NodeRow, []>("SELECT id, body FROM nodes ORDER BY id").all();
  const nodes: KbNode[] = [];
  for (const row of rows) {
    try {
      nodes.push(decodeStoredNode(JSON.parse(row.body)));
    } catch (err) {
      throw domainError(
        "invalid_input",
        `invalid node at ${path}#${row.id}: ${err instanceof Error ? err.message : String(err)}`,
        { path, id: row.id },
      );
    }
  }
  return nodes;
}
