/**
 * The store's one connection to `.kb/kb.sqlite`.
 *
 * Opened lazily and kept for the store's lifetime: `EffectStore` is built once
 * per session and handed around as a plain value — layers, actions and the
 * watcher all hold it and none of them has a scope to hang a connection off —
 * so the only owner with the right lifetime is the store itself.
 *
 * {@link SqliteConnection.peek} is the half that makes presence-based selection
 * work: reads must never bring the file into existence, or a store that was
 * only ever loaded from would make the selector see two stores under one root.
 */
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Duration, Effect, Option, Predicate } from "effect";
import { takeWriteLock, WRITE_LOCK_WAIT } from "@kb/contracts";
import { domainError, isDomainError, type DomainError } from "@kb/model";

const BUSY_TIMEOUT = `PRAGMA busy_timeout = ${String(Duration.toMillis(WRITE_LOCK_WAIT))}`;

/** Bumped when the table shape changes; stored in `meta` so a file can say. */
const SCHEMA_VERSION = "6";

/**
 * `meta.rev` is the store's commit mark, and the database keeps it: a trigger
 * per kind of row change on `nodes` bumps it, so it moves for every writer —
 * this store, another process, a hand-run `sqlite3` — and means the same thing
 * on every connection. One kind of change, one trigger each; sqlite has no
 * statement-level triggers, so a commit of n rows moves it by n.
 */
const REV_TRIGGERS = ["INSERT", "UPDATE", "DELETE"].map(
  (change) =>
    `CREATE TRIGGER IF NOT EXISTS nodes_rev_${change.toLowerCase()} AFTER ${change} ON nodes
     BEGIN
       UPDATE meta SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT) WHERE key = 'rev';
     END`,
);

/** Check for a table without upgrading a database that does not have it yet. */
export function hasTable(db: Database, name: string): boolean {
  return (
    db
      .query<unknown, [string]>("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = ?")
      .get(name) !== null
  );
}

/** The store's commit mark: `meta.rev`, or null when the database has none. */
export function commitMark(db: Database): string | null {
  if (!hasTable(db, "meta")) return null;
  return (
    db.query<{ value: string }, []>("SELECT value FROM meta WHERE key = 'rev'").get()?.value ?? null
  );
}

export interface SqliteConnection {
  /** The open handle, or one for an existing file — never creates the file. */
  peek: () => Database | null;
  /** Wait for the write lock, then run and finish a transaction in one synchronous turn. */
  write: <A>(run: (db: Database) => A) => Effect.Effect<A, DomainError>;
  /** Drop the handle. Tests own store lifetimes; production has one session. */
  close: () => void;
}

function hasCurrentSchema(db: Database): boolean {
  if (!hasTable(db, "meta")) return false;
  return (
    db.query<{ value: string }, []>("SELECT value FROM meta WHERE key = 'schema_version'").get()
      ?.value === SCHEMA_VERSION
  );
}

function migrate(db: Database): void {
  db.run("CREATE TABLE IF NOT EXISTS nodes (id TEXT PRIMARY KEY, body TEXT NOT NULL)");
  db.run("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)");
  // The store's durable transaction tail; see `tx-tail.ts` for what each
  // column is for. `IF NOT EXISTS` is the whole migration from schema 1: the
  // table is additive and an existing database gains an empty tail, which is
  // exactly the state `TxTail.isCurrent` already knows how to report.
  db.run(
    `CREATE TABLE IF NOT EXISTS tx (
       rev INTEGER PRIMARY KEY,
       at TEXT NOT NULL,
       origin TEXT,
       actor TEXT,
       session TEXT,
       via TEXT,
       ops TEXT NOT NULL,
       mark TEXT NOT NULL
     )`,
  );
  // Schemas 4–6 each added one optional metadata column to the tail.
  const columns = db.query<{ name: string }, []>("PRAGMA table_info(tx)").all();
  for (const name of ["actor", "session", "via"]) {
    if (!columns.some((column) => column.name === name)) {
      db.run(`ALTER TABLE tx ADD COLUMN ${name} TEXT`);
    }
  }
  db.run(
    `INSERT INTO meta (key, value) VALUES ('schema_version', '${SCHEMA_VERSION}'), ('rev', '0')
     ON CONFLICT(key) DO NOTHING`,
  );
  // `IF NOT EXISTS` is the whole migration from schema 2, whose store bumped
  // `rev` itself: the count carries on from wherever that left it.
  for (const trigger of REV_TRIGGERS) db.run(trigger);
  db.run(`UPDATE meta SET value = '${SCHEMA_VERSION}' WHERE key = 'schema_version'`);
}

function sqliteLockCode(error: unknown): "SQLITE_BUSY" | "SQLITE_LOCKED" | null {
  if (!Predicate.hasProperty(error, "code")) return null;
  const { code } = error;
  return code === "SQLITE_BUSY" || code === "SQLITE_LOCKED" ? code : null;
}

/** Only contention when acquiring the write lock is retried. */
function tryBeginWrite(db: Database): boolean {
  db.run("PRAGMA busy_timeout = 0");
  try {
    const journal = db.query<{ journal_mode: string }, []>("PRAGMA journal_mode").get();
    if (journal?.journal_mode !== "wal") db.run("PRAGMA journal_mode = WAL");
    db.run("BEGIN IMMEDIATE");
    return true;
  } catch (error) {
    if (sqliteLockCode(error) !== null) return false;
    throw error;
  } finally {
    db.run(BUSY_TIMEOUT);
  }
}

export function sqliteConnection(path: string): SqliteConnection {
  let handle: { db: Database; mode: "read" | "write" } | null = null;

  const connect = (db: Database, mode: "read" | "write"): Database => {
    try {
      if (mode === "write") db.run("PRAGMA synchronous = NORMAL");
      db.run(BUSY_TIMEOUT);
    } catch (error) {
      db.close(false);
      throw error;
    }
    handle?.db.close(false);
    handle = { db, mode };
    return db;
  };

  const writer = (): Database => {
    if (handle?.mode === "write") return handle.db;
    mkdirSync(dirname(path), { recursive: true });
    return connect(new Database(path, { create: true }), "write");
  };

  return {
    peek: () => {
      const db =
        handle?.db ??
        (existsSync(path) ? connect(new Database(path, { readonly: true }), "read") : null);
      // An empty file can be visible before another process creates its tables.
      return db !== null && hasTable(db, "nodes") ? db : null;
    },
    write: (run) =>
      takeWriteLock(
        () =>
          Effect.try({
            try: () => {
              const db = writer();
              try {
                if (!tryBeginWrite(db)) return Option.none();
                // Upgrade under the lock this write already acquired.
                if (!hasCurrentSchema(db)) migrate(db);
                const value = run(db);
                db.run("COMMIT");
                return Option.some(value);
              } catch (error) {
                if (db.inTransaction) db.run("ROLLBACK");
                throw error;
              }
            },
            catch: (error) => {
              if (isDomainError(error)) return error;
              const message = error instanceof Error ? error.message : String(error);
              const code = sqliteLockCode(error);
              return code === null
                ? domainError("internal", `write ${path}: ${message}`, { path })
                : domainError("conflict", `store busy: ${message}`, { path, code });
            },
          }),
        Effect.fail(domainError("conflict", `store busy: timed out waiting for ${path}`, { path })),
      ),
    close: () => {
      handle?.db.close(false);
      handle = null;
    },
  };
}
