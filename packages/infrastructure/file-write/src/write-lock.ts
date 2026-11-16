/**
 * Exclusive write lock for whole-file commits.
 * Cover load → mutate → durable replace so concurrent CLI/MCP/UI writers
 * cannot silently clobber each other (r4 Stage-0).
 *
 * The lock is the kernel's: the holder opens `<path>.lock` and takes
 * flock(2) on it, and the kernel releases it when the holder unlocks,
 * closes it or dies. A dead holder's lock is free the moment it dies, so
 * there is no stale detection and no takeover. The holder removes the file
 * while it still holds it; an acquirer that locked a file no longer at the
 * path lets it go and tries again, so two writers never lock two different
 * files. The file holds the holder's pid only to name it in a timeout.
 * DESIGN.md → JSONL store → write hardening.
 *
 * Acquisition takes the lock without blocking and sleeps via Effect.sleep
 * between tries (never Bun.sleepSync), so concurrent commits on the same
 * event loop can make progress.
 */
import { dlopen, FFIType, read } from "bun:ffi";
import {
  closeSync,
  fstatSync,
  ftruncateSync,
  mkdirSync,
  openSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { dirname } from "node:path";
import { Clock, Duration, Effect } from "effect";
import { domainError, type DomainError } from "@kb/model";

const LOCK_SUFFIX = ".lock";
const SPIN_MS = 25;
const MAX_WAIT_MS = 15_000;

const LOCK_EX = 2;
const LOCK_NB = 4;
const LOCK_UN = 8;
const EINTR = 4;
/** "Someone else holds it", flock's answer under LOCK_NB: EWOULDBLOCK. */
const EWOULDBLOCK = process.platform === "darwin" ? 35 : 11;

export function lockPathFor(filePath: string): string {
  return `${filePath}${LOCK_SUFFIX}`;
}

/** libc's flock, and the errno it sets. */
interface Flock {
  readonly flock: (fd: number, operation: number) => number;
  readonly errno: () => number;
}

function loadFlock(): Flock {
  if (process.platform === "darwin") {
    const lib = dlopen("/usr/lib/libSystem.B.dylib", {
      flock: { args: [FFIType.i32, FFIType.i32], returns: FFIType.i32 },
      __error: { args: [], returns: FFIType.ptr },
    });
    return {
      flock: (fd, operation) => lib.symbols.flock(fd, operation),
      errno: () => {
        const at = lib.symbols.__error();
        return at === null ? 0 : read.i32(at, 0);
      },
    };
  }
  const lib = dlopen("libc.so.6", {
    flock: { args: [FFIType.i32, FFIType.i32], returns: FFIType.i32 },
    __errno_location: { args: [], returns: FFIType.ptr },
  });
  return {
    flock: (fd, operation) => lib.symbols.flock(fd, operation),
    errno: () => {
      const at = lib.symbols.__errno_location();
      return at === null ? 0 : read.i32(at, 0);
    },
  };
}

/** Loaded with the first lock, so a command that writes nothing loads no library. */
let libc: Flock | undefined;
function flockOf(): Flock {
  libc ??= loadFlock();
  return libc;
}

/**
 * The open lock files this process holds, by lock path. A path has one entry
 * at most: a second acquirer here opens its own file description, which
 * flock refuses while the first holds the lock.
 */
const held = new Map<string, number>();

/** Try once: true when this fd now holds the lock, false when another does. */
function tryLock(fd: number): boolean {
  const lib = flockOf();
  for (;;) {
    if (lib.flock(fd, LOCK_EX | LOCK_NB) === 0) return true;
    const errno = lib.errno();
    if (errno === EINTR) continue;
    if (errno === EWOULDBLOCK) return false;
    throw new Error(`flock failed with errno ${errno}`);
  }
}

/** Whether the open file is still the one at the path: its holder may have removed it. */
function isAtPath(fd: number, lockPath: string): boolean {
  const open = fstatSync(fd);
  try {
    const now = statSync(lockPath);
    return now.ino === open.ino && now.dev === open.dev;
  } catch {
    return false;
  }
}

const openLock = (lockPath: string): number => {
  mkdirSync(dirname(lockPath), { recursive: true });
  return openSync(lockPath, "a+", 0o600);
};

function readLockPid(lockPath: string): number | null {
  try {
    const pid = Number(readFileSync(lockPath, "utf8").trim());
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

/** Record this process as the holder, for a waiter's timeout to name. */
function writeHolder(fd: number): void {
  ftruncateSync(fd, 0);
  writeSync(fd, `${process.pid}\n`, 0);
}

const lockFailure = (lockPath: string, step: string) => (err: unknown) =>
  domainError(
    "internal",
    `failed to ${step} write lock ${lockPath}: ${err instanceof Error ? err.message : String(err)}`,
    { lockPath },
  );

/** Effectful acquire — yields while spinning so other fibers can run. */
export const acquireFileWriteLockEffect = Effect.fn("kb.acquireWriteLock")(function* (
  filePath: string,
): Effect.fn.Return<string, DomainError> {
  const lockPath = lockPathFor(filePath);
  // The file this waiter has open; replaced when the one it locked is gone.
  let fd = yield* Effect.try({
    try: () => openLock(lockPath),
    catch: lockFailure(lockPath, "open"),
  });

  const spin = Effect.gen(function* () {
    const started = yield* Clock.currentTimeMillis;
    for (;;) {
      const got = yield* Effect.try({
        try: () => {
          if (!tryLock(fd)) return false;
          if (isAtPath(fd, lockPath)) return true;
          // The holder before removed this file as it let go: lock the one there now.
          closeSync(fd);
          fd = openLock(lockPath);
          return tryLock(fd) && isAtPath(fd, lockPath);
        },
        catch: lockFailure(lockPath, "acquire"),
      });
      if (got) {
        yield* Effect.try({
          try: () => writeHolder(fd),
          catch: lockFailure(lockPath, "record the holder of"),
        });
        held.set(lockPath, fd);
        return lockPath;
      }
      if ((yield* Clock.currentTimeMillis) - started > MAX_WAIT_MS) {
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
  // A waiter that fails or is interrupted closes its file; a holder keeps it
  // open until it releases.
  return yield* spin.pipe(Effect.onError(() => Effect.sync(() => closeSync(fd))));
});

/** Release a lock acquired by {@link acquireFileWriteLockEffect} (best-effort). */
export function releaseFileWriteLock(lockPath: string): void {
  const fd = held.get(lockPath);
  if (fd === undefined) return;
  held.delete(lockPath);
  try {
    // Removed while still held, so no waiter can lock a file that stays.
    unlinkSync(lockPath);
    flockOf().flock(fd, LOCK_UN);
  } catch {
    // best-effort: closing below releases the lock either way
  } finally {
    closeSync(fd);
  }
}
