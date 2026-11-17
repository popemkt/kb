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
 * files. The file holds the holder's pid, to name it in a timeout and for
 * an older kb (below). DESIGN.md → JSONL store → write hardening.
 *
 * An older kb, from before this lock, takes no flock: it holds the lock by
 * keeping its live pid in the file, and takes a file whose pid is dead or
 * missing. So the file is never without a live pid (created whole, by a
 * hard link, and overwritten in place), and a writer holding the flock
 * still waits on a live pid that an older kb wrote. Ours is right-aligned
 * in a fixed field, so theirs is any other form. That reading goes one
 * release after this ships (todo 01M7K50TFYFRWRJBTQ8V76489P).
 *
 * Acquisition takes the lock without blocking and sleeps via Effect.sleep
 * between tries (never Bun.sleepSync), so concurrent commits on the same
 * event loop can make progress.
 */
import { dlopen, FFIType, read } from "bun:ffi";
import {
  closeSync,
  constants,
  fstatSync,
  ftruncateSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { dirname } from "node:path";
import { Clock, Duration, Effect, Predicate } from "effect";
import { domainError, type DomainError } from "@kb/model";

const LOCK_SUFFIX = ".lock";
const SPIN_MS = 25;
const MAX_WAIT_MS = 15_000;
/**
 * How long an empty lock file is an older kb's that has yet to write its
 * pid. Ours is never empty; an older kb writes its pid within microseconds
 * of creating the file, or crashed doing so.
 */
const UNWRITTEN_GRACE_MS = 2_000;
/** A holder's pid is right-aligned in this many characters, then a newline. */
const RECORD_WIDTH = 12;

/** Temp names are pid + sequence, unique without the clock or randomness (as durable-replace's). */
let tmpSeq = 0;

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
    const now = lstatSync(lockPath);
    return now.ino === open.ino && now.dev === open.dev;
  } catch {
    return false;
  }
}

/** The `code` of a thrown node fs/process error, when it carries one. */
function errnoCode(err: unknown): string | undefined {
  return Predicate.hasProperty(err, "code") && typeof err.code === "string" ? err.code : undefined;
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM: the process exists but this one may not signal it.
    return errnoCode(err) === "EPERM";
  }
}

/** This process as the file names its holder: an older kb reads it as a pid. */
const holderRecord = (pid: number): string => `${String(pid).padStart(RECORD_WIDTH)}\n`;

/** Whether a holder that takes the flock wrote this, rather than an older kb. */
const isHolderRecord = (text: string): boolean =>
  text.length === RECORD_WIDTH + 1 && /^ +[1-9][0-9]*\n$/.test(text);

/**
 * Open the lock file at the path, creating it whole when there is none: the
 * pid is in it from the moment it exists, so an older kb never reads an
 * empty lock as a dead holder's.
 */
function openLock(lockPath: string): number {
  mkdirSync(dirname(lockPath), { recursive: true });
  for (;;) {
    try {
      return openSync(lockPath, constants.O_RDWR | constants.O_NOFOLLOW);
    } catch (err) {
      const code = errnoCode(err);
      if (code === "ELOOP") {
        throw new Error(`${lockPath} is a symbolic link, not a lock file: remove it`, {
          cause: err,
        });
      }
      if (code !== "ENOENT") throw err;
    }
    // Overwrite, not exclusive: a temp at this name is a dead process's that had this pid.
    const tmp = `${lockPath}.${process.pid}.${tmpSeq++}.tmp`;
    writeNoFollow(tmp, holderRecord(process.pid));
    try {
      linkSync(tmp, lockPath);
    } catch (err) {
      if (errnoCode(err) !== "EEXIST") throw err;
    } finally {
      unlinkSync(tmp);
    }
  }
}

/** Write a whole file, refusing a symbolic link at its path (ELOOP) rather than writing through it. */
function writeNoFollow(path: string, text: string): void {
  const fd = openSync(
    path,
    constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW,
    0o600,
  );
  try {
    writeSync(fd, text);
  } finally {
    closeSync(fd);
  }
}

function readLockText(fd: number): string {
  const buffer = Buffer.alloc(64);
  return buffer.toString("utf8", 0, readSync(fd, buffer, 0, buffer.length, 0));
}

/** The pid an older kb's lock names, alive or not; null when it names none. */
function olderPid(text: string): number | null {
  const pid = Number(text.trim());
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

/**
 * Whether an older kb holds the lock this fd has the flock on: its live pid
 * is in the file, or it has just created the file and not yet written one.
 */
// GAP [[01M7K7RWGW47P9WY09SZTAEP4B]] an older kb stealing a dead pid can collide with an in-place take.
function olderKbHolds(fd: number, nowMs: number): boolean {
  const text = readLockText(fd);
  if (isHolderRecord(text)) return false;
  if (text === "") return nowMs - fstatSync(fd).mtimeMs <= UNWRITTEN_GRACE_MS;
  const pid = olderPid(text);
  return pid !== null && pid !== process.pid && pidAlive(pid);
}

/**
 * Record this process as the holder, over whatever pid is there and without
 * emptying the file first, so an older kb never sees it without a live pid.
 */
function writeHolder(fd: number): void {
  const record = holderRecord(process.pid);
  writeSync(fd, record, 0);
  ftruncateSync(fd, record.length);
}

/**
 * Try once to enter on this file: take the flock, then make sure no older kb
 * holds the file, then record this process and check the file is still the
 * one at the path. Lets the flock go unless it enters.
 */
function tryEnter(fd: number, lockPath: string, nowMs: number): boolean {
  if (!tryLock(fd)) return false;
  if (!olderKbHolds(fd, nowMs)) {
    writeHolder(fd);
    if (isAtPath(fd, lockPath)) return true;
  }
  flockOf().flock(fd, LOCK_UN);
  return false;
}

/** Who a waiter that gave up was waiting on, for its error. */
function describeHolder(lockPath: string): {
  readonly holder: number | null;
  readonly note: string;
} {
  let text: string;
  try {
    text = readFileSync(lockPath, "utf8");
  } catch {
    return { holder: null, note: "" };
  }
  if (isHolderRecord(text)) {
    const holder = Number(text.trim());
    return { holder, note: ` (held by pid ${holder})` };
  }
  const holder = olderPid(text);
  return {
    holder,
    note:
      holder === null
        ? ""
        : ` (held by pid ${holder}, an older kb that does not take the kernel lock: stop it to write)`,
  };
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
      const now = yield* Clock.currentTimeMillis;
      const got = yield* Effect.try({
        try: () => {
          if (tryEnter(fd, lockPath, now)) return true;
          if (isAtPath(fd, lockPath)) return false;
          // The holder before removed this file as it let go: try the one there now.
          closeSync(fd);
          fd = openLock(lockPath);
          return tryEnter(fd, lockPath, now);
        },
        catch: lockFailure(lockPath, "acquire"),
      });
      if (got) {
        held.set(lockPath, fd);
        return lockPath;
      }
      if (now - started > MAX_WAIT_MS) {
        const { holder, note } = describeHolder(lockPath);
        return yield* domainError(
          "conflict",
          `timed out waiting for write lock ${lockPath}${note}`,
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
