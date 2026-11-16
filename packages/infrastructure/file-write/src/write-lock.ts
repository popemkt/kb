/**
 * Exclusive write lock for whole-file commits.
 * Cover load → mutate → durable replace so concurrent CLI/MCP/UI writers
 * cannot silently clobber each other (r4 Stage-0).
 *
 * Lock file: `<path>.lock` with the holder pid. A lock is created whole:
 * the pid is written to a temp file first and then hard-linked to the lock
 * path, which fails if a lock is there. So no process ever reads a lock
 * without its holder. Created in place and then written, an empty lock read
 * as pid 0, a dead holder, and a second process stole a lock its holder had
 * just taken; both then wrote, and one write was lost.
 *
 * A stale lock (dead holder, or no pid and older than a writer needs to
 * write one) is stolen by renaming it aside. The thief then checks that what
 * it moved was the lock it judged stale; if a live holder's lock was moved
 * instead, it puts that lock back.
 *
 * Acquisition sleeps via Effect.sleep (never Bun.sleepSync) so concurrent
 * commits on the same event loop can make progress.
 */
import {
  linkSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { Clock, Duration, Effect, Predicate } from "effect";
import { domainError, type DomainError } from "@kb/model";

const LOCK_SUFFIX = ".lock";
const SPIN_MS = 25;
const MAX_WAIT_MS = 15_000;
/**
 * How old a lock with no pid must be before it is stale. The current writer
 * never leaves one; an older one, or a crash mid-write, can, and a holder
 * writes its pid within microseconds of creating the file.
 */
const UNWRITTEN_GRACE_MS = 2_000;

/** Temp names are pid + sequence, unique without the clock or randomness (as durable-replace's). */
let tmpSeq = 0;

export function lockPathFor(filePath: string): string {
  return `${filePath}${LOCK_SUFFIX}`;
}

/** The `code` of a thrown node fs/process error, when it carries one. */
function errnoCode(err: unknown): string | undefined {
  return Predicate.hasProperty(err, "code") && typeof err.code === "string" ? err.code : undefined;
}

function pidAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM: process exists but we can't signal it — treat as alive.
    return errnoCode(err) === "EPERM";
  }
}

/** The holder's pid; null when the file holds none (empty or not a number), or is missing. */
function readLockPid(lockPath: string): number | null {
  try {
    const raw = readFileSync(lockPath, "utf8").trim();
    if (raw === "") return null;
    const pid = Number(raw);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

/** A lock file as one read sees it: its holder and when it was written. */
interface LockState {
  readonly pid: number | null;
  readonly ino: number;
  readonly mtimeMs: number;
}

function readLock(lockPath: string): LockState | null {
  try {
    const stat = statSync(lockPath);
    return { pid: readLockPid(lockPath), ino: stat.ino, mtimeMs: stat.mtimeMs };
  } catch (err) {
    if (errnoCode(err) === "ENOENT") return null;
    throw err;
  }
}

/** One lock file, not a later one: an inode number is reused once its file is gone. */
function sameLock(a: LockState | null, b: LockState): boolean {
  return a !== null && a.ino === b.ino && a.pid === b.pid && a.mtimeMs === b.mtimeMs;
}

function isStale(lock: LockState, nowMs: number): boolean {
  if (lock.pid !== null) return !pidAlive(lock.pid);
  return nowMs - lock.mtimeMs > UNWRITTEN_GRACE_MS;
}

/** Create the lock whole: its pid is in it from the moment it exists. */
function tryCreateLock(lockPath: string): boolean {
  // Overwrite, not exclusive: a file at this name was left by a dead process
  // that had this pid, and must not keep this one from locking.
  const tmp = `${lockPath}.${process.pid}.${tmpSeq++}.tmp`;
  writeFileSync(tmp, `${process.pid}\n`);
  try {
    linkSync(tmp, lockPath);
    return true;
  } catch (err) {
    if (errnoCode(err) === "EEXIST") return false;
    throw err;
  } finally {
    unlinkSync(tmp);
  }
}

/**
 * Take a stale lock. Renaming moves exactly one file, so of two thieves only
 * one moves the stale lock. The other moves whatever is there by then, which
 * may be the first thief's new lock; seeing a different file than it judged,
 * it links that one back and keeps waiting. Between that move and the link
 * back the path is empty, so a third writer arriving in those microseconds,
 * after a holder died, could take it too. Without an OS file lock, which
 * node:fs does not offer, that window can be narrowed but not closed.
 */
function stealIfStale(lockPath: string, nowMs: number): boolean {
  const judged = readLock(lockPath);
  if (judged === null || !isStale(judged, nowMs)) return false;
  const aside = `${lockPath}.${process.pid}.${tmpSeq++}.stale.tmp`;
  try {
    renameSync(lockPath, aside);
  } catch (err) {
    if (errnoCode(err) === "ENOENT") return false;
    throw err;
  }
  const moved = readLock(aside);
  if (!sameLock(moved, judged)) {
    try {
      linkSync(aside, lockPath);
    } catch (err) {
      if (errnoCode(err) !== "EEXIST") throw err;
    }
    unlinkSync(aside);
    return false;
  }
  unlinkSync(aside);
  return tryCreateLock(lockPath);
}

function ensureLockDir(lockPath: string): void {
  mkdirSync(dirname(lockPath), { recursive: true });
}

/** Effectful acquire — yields while spinning so other fibers can run. */
export const acquireFileWriteLockEffect = Effect.fn("kb.acquireWriteLock")(function* (
  filePath: string,
): Effect.fn.Return<string, DomainError> {
  const lockPath = lockPathFor(filePath);
  yield* Effect.try({
    try: () => ensureLockDir(lockPath),
    catch: (err) =>
      domainError(
        "internal",
        `failed to create lock directory for ${lockPath}: ${
          err instanceof Error ? err.message : String(err)
        }`,
        { lockPath },
      ),
  });

  const started = yield* Clock.currentTimeMillis;
  for (;;) {
    const now = yield* Clock.currentTimeMillis;
    const got = yield* Effect.try({
      try: () => tryCreateLock(lockPath) || stealIfStale(lockPath, now),
      catch: (err) =>
        domainError(
          "internal",
          `failed to acquire write lock ${lockPath}: ${
            err instanceof Error ? err.message : String(err)
          }`,
          { lockPath },
        ),
    });
    if (got) return lockPath;

    if (now - started > MAX_WAIT_MS) {
      const holder = readLockPid(lockPath);
      return yield* domainError(
        "conflict",
        `timed out waiting for write lock ${lockPath}` +
          (holder !== null ? ` (held by pid ${holder})` : ""),
        { lockPath, holder },
      );
    }
    yield* Effect.sleep(Duration.millis(SPIN_MS));
  }
});

/** Release a lock acquired by {@link acquireFileWriteLockEffect} (best-effort). */
export function releaseFileWriteLock(lockPath: string): void {
  try {
    // Only this process's own lock: one with no pid may be another writer's.
    if (readLockPid(lockPath) === process.pid) unlinkSync(lockPath);
  } catch {
    // best-effort release
  }
}
