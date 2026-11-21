/**
 * What SqliteStore does that the port does not promise: the on-disk shape, a
 * fingerprint the database itself keeps, and atomicity when a write fails
 * part-way through the transaction.
 */
import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { Cause, Clock, Effect, Exit } from "effect";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalJson, isDomainError, present, type KbNode } from "@kb/model";
import { WriteLockDeadline } from "@kb/contracts";
import { SqliteStore } from "../src/index.ts";

const AT = "2026-01-01T00:00:00.000Z";

function node(id: string, text: string): KbNode {
  return { id, text, props: {}, children: [], createdAt: AT, updatedAt: AT };
}

/** A scratch root plus an open store, both released when the scope closes. */
const scratchStore = Effect.gen(function* () {
  const root = yield* Effect.acquireRelease(
    Effect.promise(() => mkdtemp(join(tmpdir(), "kb-sqlite-"))),
    (dir) => Effect.promise(() => rm(dir, { recursive: true, force: true })),
  );
  return yield* Effect.acquireRelease(
    Effect.sync(() => new SqliteStore(root)),
    (store) => store.closeEffect,
  );
});

/** Start a scratch writer and wait for it to announce its state. */
const startWriter = Effect.fnUntraced(function* (script: string, args: string[], ready: string) {
  const child = yield* Effect.acquireRelease(
    Effect.sync(() =>
      Bun.spawn([process.execPath, "-e", script, "--", ...args], {
        stdin: "pipe",
        stdout: "pipe",
        stderr: "inherit",
      }),
    ),
    (writer) =>
      Effect.promise(async () => {
        writer.kill("SIGKILL");
        await writer.exited;
      }),
  );
  const output = child.stdout.getReader();
  const line = yield* Effect.promise(() => output.read()).pipe(Effect.timeout("5 seconds"));
  output.releaseLock();
  expect(new TextDecoder().decode(line.value).trim()).toBe(ready);
  return child;
});

/** Run `body` against a raw second connection to the same database. */
function withRawConnection(path: string, body: (db: Database) => void): void {
  const db = new Database(path);
  try {
    body(db);
  } finally {
    db.close(false);
  }
}

function failureOf(exit: Exit.Exit<unknown, unknown>): unknown {
  return Exit.isFailure(exit) ? Cause.squash(exit.cause) : null;
}

describe("SqliteStore", () => {
  test("an expired first commit leaves the database absent", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const store = yield* scratchStore;
          const deadline = yield* Clock.currentTimeMillis;
          const error = yield* Effect.flip(
            store.commitEffect({ upserts: [node("n-a", "a")], deletes: [] }, { at: AT }),
          ).pipe(Effect.provideService(WriteLockDeadline, deadline));
          expect(error.code).toBe("conflict");
          expect(existsSync(store.path)).toBe(false);
        }),
      ),
    ));

  test("a store that is only read from never creates its file", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const store = yield* scratchStore;
          expect(yield* store.loadEffect).toEqual([]);
          // Presence selects the adapter: a load that conjured the database
          // would make the selector see two stores under one root.
          expect(existsSync(store.path)).toBe(false);
        }),
      ),
    ));

  test("a read-only session sees committed WAL rows without checkpointing a crashed writer", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const store = yield* scratchStore;
          // The only writer must be gone when the parent opens the database.
          const writer = yield* startWriter(
            `const { SqliteStore } = await import(process.argv[1]);
             const { Effect } = await import(process.argv[2]);
             const store = new SqliteStore(process.argv[3]);
             const upserts = [${JSON.stringify(node("n-a", "after"))}];
             await Effect.runPromise(store.commitEffect({ upserts, deletes: [] }, { at: upserts[0].createdAt }));
             console.log("committed");
             await Bun.stdin.text();`,
            [
              import.meta.resolve("../src/index.ts"),
              import.meta.resolve("effect"),
              join(store.path, "../.."),
            ],
            "committed",
          );
          writer.kill("SIGKILL");
          yield* Effect.promise(() => writer.exited);

          const before = yield* Effect.promise(() => readFile(store.path));
          expect(yield* Effect.promise(() => Bun.file(`${store.path}-wal`).exists())).toBe(true);
          expect((yield* store.loadEffect).map(({ text }) => text)).toEqual(["after"]);
          yield* store.closeEffect;
          const after = yield* Effect.promise(() => readFile(store.path));
          expect(after.equals(before)).toBe(true);
        }),
      ),
    ));

  test("a rollback-journal read fails while another process holds an exclusive lock", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const store = yield* scratchStore;
          const writer = yield* startWriter(
            `import { Database } from "bun:sqlite";
             import { mkdirSync } from "node:fs";
             import { dirname } from "node:path";
             const path = process.argv[1];
             mkdirSync(dirname(path), { recursive: true });
             const db = new Database(path);
             db.run("PRAGMA journal_mode = DELETE");
             db.run("CREATE TABLE nodes (id TEXT PRIMARY KEY, body TEXT NOT NULL)");
             db.run("INSERT INTO nodes VALUES (?, ?)", ["n-a", process.argv[2]]);
             db.run("BEGIN EXCLUSIVE");
             console.log("locked");
             await Promise.race([Bun.stdin.text(), Bun.sleep(2000)]);
             db.run("ROLLBACK");
             db.close();
             process.exit(0);`,
            [store.path, canonicalJson(node("n-a", "a"))],
            "locked",
          );
          // If SQLite waits synchronously, the child's fail-safe unlocks and
          // the read succeeds. It should fail while the lock is still held.
          const error = yield* Effect.flip(store.loadEffect);
          expect(error.message).toContain("database is locked");
          yield* Effect.promise(() => Promise.resolve(writer.stdin.end()));
          expect(yield* Effect.promise(() => writer.exited)).toBe(0);
          expect((yield* store.loadEffect).map(({ text }) => text)).toEqual(["a"]);
        }),
      ),
    ));

  test("a node is one row whose body is the canonical JSON the JSONL also writes", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const store = yield* scratchStore;
          // Ranked already, so the row holds exactly what was written.
          const written = { ...node("n-a", "a"), order: "i" };
          yield* store.commitEffect({ upserts: [written], deletes: [] }, { at: AT });

          withRawConnection(store.path, (db) => {
            const row = db
              .query<{ id: string; body: string }, []>("SELECT id, body FROM nodes")
              .get();
            expect(present(row, "expected a nodes row").id).toBe("n-a");
            expect(present(row, "expected a nodes row").body).toBe(canonicalJson(written));

            const version = db
              .query<{ value: string }, []>("SELECT value FROM meta WHERE key = 'schema_version'")
              .get();
            // 6 since the tail records the caller's via of each commit; see `connection.ts`.
            expect(present(version, "expected schema_version").value).toBe("6");
          });
        }),
      ),
    ));

  test("a schema-3 tail gains the actor column: its rows read back, and a new commit records who made it", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const root = yield* Effect.acquireRelease(
            Effect.promise(() => mkdtemp(join(tmpdir(), "kb-sqlite-"))),
            (dir) => Effect.promise(() => rm(dir, { recursive: true, force: true })),
          );
          const store = new SqliteStore(root);
          yield* store.commitEffect({ upserts: [node("n-a", "a")], deletes: [] }, { at: AT });
          yield* store.closeEffect;
          // Back to schema 3: the tail as it was before `actor` was recorded.
          withRawConnection(store.path, (db) => {
            db.run("ALTER TABLE tx DROP COLUMN actor");
            db.run("ALTER TABLE tx DROP COLUMN session");
            db.run("ALTER TABLE tx DROP COLUMN via");
            db.run("UPDATE meta SET value = '3' WHERE key = 'schema_version'");
          });

          const reopened = new SqliteStore(root);
          try {
            expect(reopened.txTail.entries().map((tx) => tx.rev)).toEqual([1]);
            yield* reopened.commitEffect(
              { upserts: [node("n-b", "b")], deletes: [] },
              { at: AT, actor: "human" },
            );
            const [old, made] = reopened.txTail.entries();
            expect(old !== undefined && "actor" in old).toBe(false);
            expect(made?.actor).toBe("human");
          } finally {
            yield* reopened.closeEffect;
          }
        }),
      ),
    ));

  test("a schema-4 tail gains the session column: its rows read back, and a new commit records its session", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const root = yield* Effect.acquireRelease(
            Effect.promise(() => mkdtemp(join(tmpdir(), "kb-sqlite-"))),
            (dir) => Effect.promise(() => rm(dir, { recursive: true, force: true })),
          );
          const store = new SqliteStore(root);
          yield* store.commitEffect({ upserts: [node("n-a", "a")], deletes: [] }, { at: AT });
          yield* store.closeEffect;
          // Back to schema 4: the tail as it was before `session` was recorded.
          withRawConnection(store.path, (db) => {
            db.run("ALTER TABLE tx DROP COLUMN session");
            db.run("ALTER TABLE tx DROP COLUMN via");
            db.run("UPDATE meta SET value = '4' WHERE key = 'schema_version'");
          });

          const reopened = new SqliteStore(root);
          try {
            expect(reopened.txTail.entries().map((tx) => tx.rev)).toEqual([1]);
            yield* reopened.commitEffect(
              { upserts: [node("n-b", "b")], deletes: [] },
              { at: AT, actor: "agent", session: "tab.a" },
            );
            const [old, made] = reopened.txTail.entries();
            expect(old !== undefined && "session" in old).toBe(false);
            expect(made?.session).toBe("tab.a");
          } finally {
            yield* reopened.closeEffect;
          }
        }),
      ),
    ));

  test("a cold schema-5 read proceeds under the write lock and the first commit upgrades it", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const root = yield* Effect.acquireRelease(
            Effect.promise(() => mkdtemp(join(tmpdir(), "kb-sqlite-"))),
            (dir) => Effect.promise(() => rm(dir, { recursive: true, force: true })),
          );
          const store = new SqliteStore(root);
          yield* store.commitEffect({ upserts: [node("n-a", "a")], deletes: [] }, { at: AT });
          yield* store.closeEffect;
          // Back to schema 5: the tail as it was before `via` was recorded.
          withRawConnection(store.path, (db) => {
            db.run("ALTER TABLE tx DROP COLUMN via");
            db.run("UPDATE meta SET value = '5' WHERE key = 'schema_version'");
          });

          const reopened = new SqliteStore(root);
          try {
            withRawConnection(store.path, (db) => {
              db.run("BEGIN IMMEDIATE");
              expect(Effect.runSync(reopened.loadEffect).map(({ id }) => id)).toEqual(["n-a"]);
              expect(reopened.txTail.entries().map(({ rev }) => rev)).toEqual([1]);
              expect(db.query("SELECT value FROM meta WHERE key = 'schema_version'").get()).toEqual(
                {
                  value: "5",
                },
              );
              db.run("ROLLBACK");
            });
            yield* reopened.commitEffect(
              { upserts: [node("n-b", "b")], deletes: [] },
              { at: AT, actor: "agent", via: "job:a" },
            );
            const [old, made] = reopened.txTail.entries();
            expect(old !== undefined && "via" in old).toBe(false);
            expect(made?.via).toBe("job:a");
          } finally {
            yield* reopened.closeEffect;
          }
        }),
      ),
    ));

  test("the fingerprint moves even when a commit changes no bytes", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const store = yield* scratchStore;
          const same = node("n-a", "a");
          yield* store.commitEffect({ upserts: [same], deletes: [] }, { at: AT });
          const before = yield* store.fingerprint;

          // Byte-identical content still moves `rev`: this adapter names its
          // commits, where the JSONL adapter names its content.
          yield* store.commitEffect({ upserts: [same], deletes: [] }, { at: AT });
          expect(yield* store.fingerprint).not.toBe(before);
        }),
      ),
    ));

  test("a raw connection's write moves rev, so the fingerprint moves", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const store = yield* scratchStore;
          yield* store.commitEffect({ upserts: [node("n-a", "a")], deletes: [] }, { at: AT });
          const before = yield* store.fingerprint;

          // A writer that knows nothing of `rev`: the triggers move it anyway.
          withRawConnection(store.path, (db) => {
            db.prepare<unknown, [string, string]>("INSERT INTO nodes (id, body) VALUES (?, ?)").run(
              "n-b",
              canonicalJson(node("n-b", "b")),
            );
          });

          expect(yield* store.fingerprint).not.toBe(before);
        }),
      ),
    ));

  test("a write that fails part-way through the transaction leaves the store untouched", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const store = yield* scratchStore;
          yield* store.commitEffect({ upserts: [node("n-a", "a")], deletes: [] }, { at: AT });

          // Fail the second of two inserts, after the first has already been
          // written inside the transaction: nothing short of a real rollback
          // can leave the store as it was.
          withRawConnection(store.path, (db) => {
            db.run(
              `CREATE TRIGGER poison BEFORE INSERT ON nodes WHEN NEW.id = 'n-poison'
               BEGIN SELECT RAISE(ABORT, 'poisoned'); END`,
            );
          });
          const before = yield* store.fingerprint;

          const exit = yield* Effect.exit(
            store.commitEffect(
              {
                upserts: [node("n-good", "good"), node("n-poison", "poison")],
                deletes: ["n-a"],
              },
              { at: AT },
            ),
          );

          expect(Exit.isFailure(exit)).toBe(true);
          expect(isDomainError(failureOf(exit))).toBe(true);
          expect((yield* store.loadEffect).map((n) => n.id)).toEqual(["n-a"]);
          expect(yield* store.fingerprint).toBe(before);
        }),
      ),
    ));

  test("an undecodable row fails the whole load, naming that row", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const store = yield* scratchStore;
          yield* store.commitEffect({ upserts: [node("n-a", "a")], deletes: [] }, { at: AT });

          withRawConnection(store.path, (db) => {
            db.prepare<unknown, [string, string]>("INSERT INTO nodes (id, body) VALUES (?, ?)").run(
              "n-bad",
              '{"id":1}',
            );
          });

          const exit = yield* Effect.exit(store.loadEffect);
          const err = failureOf(exit);
          expect(isDomainError(err)).toBe(true);
          if (isDomainError(err)) {
            expect(err.code).toBe("invalid_input");
            expect(err.message).toContain("n-bad");
          }
        }),
      ),
    ));
});
