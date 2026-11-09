/**
 * Durable whole-file writes: a replace with a prior-generation backup, and
 * a create that never replaces (`durableCreateFile`).
 *
 * Replace protocol:
 * Protocol:
 * 1. write candidate to tmp via fd + fsync
 * 2. copy live → .bak (best-effort prior generation)
 * 3. rename tmp → live
 * 4. fsync parent directory (when the platform allows)
 *
 * Does not change the on-disk JSONL format.
 */
import {
  closeSync,
  copyFileSync,
  existsSync,
  linkSync,
  fsyncSync,
  mkdirSync,
  openSync,
  renameSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { dirname } from "node:path";
import { domainError, type DomainError } from "@kb/model";

/**
 * Per-process temp-file counter. A wall-clock stamp collided whenever two
 * commits landed in the same millisecond and made the write path read a clock
 * it has no other reason to read; pid + sequence is unique without either.
 */
let tmpSeq = 0;

function mapErr(err: unknown, context: string): DomainError {
  const message = err instanceof Error ? err.message : String(err);
  return domainError("internal", `${context}: ${message}`);
}

function fsyncPath(path: string): void {
  const fd = openSync(path, "r");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function fsyncDir(dir: string): void {
  try {
    const fd = openSync(dir, "r");
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  } catch {
    // Directory fsync is best-effort (some FS/OS combos reject it).
  }
}

/**
 * Atomically replace `path` with `body`, optionally keeping `backupPath` as
 * the prior live contents. `mode` applies when the candidate file is created.
 */
interface FileReplacement {
  readonly path: string;
  readonly body: string;
  readonly backupPath?: string;
  readonly mode?: number;
}

export function durableReplaceFile({ path, backupPath, body, mode }: FileReplacement): void {
  const dir = dirname(path);
  try {
    mkdirSync(dir, { recursive: true });
  } catch (err) {
    throw mapErr(err, `mkdir ${dir}`);
  }

  const tmp = `${path}.${process.pid}.${tmpSeq++}.tmp`;
  try {
    const fd = openSync(tmp, "wx", mode);
    try {
      writeSync(fd, body, 0, "utf8");
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }

    if (backupPath !== undefined && existsSync(path)) {
      try {
        copyFileSync(path, backupPath);
        fsyncPath(backupPath);
      } catch (err) {
        throw mapErr(err, `backup ${path} → ${backupPath}`);
      }
    }

    try {
      renameSync(tmp, path);
    } catch (err) {
      try {
        unlinkSync(tmp);
      } catch {
        // ignore cleanup failure
      }
      throw mapErr(err, `rename ${tmp} → ${path}`);
    }

    fsyncDir(dir);
  } catch (err) {
    if (typeof err === "object" && err !== null && "code" in err && err.code === "internal") {
      throw err;
    }
    throw mapErr(err, `durable replace ${path}`);
  }
}

/**
 * Create `path` with `body` whole, or leave the file already there: the
 * body is written and synced beside it, then linked into place, which fails
 * rather than replaces when `path` exists, so of two writers racing exactly
 * one creates it and neither ever sees part of the other's. Returns whether
 * this call created it; `mode` applies to the new file.
 */
export function durableCreateFile({
  path,
  body,
  mode,
}: Omit<FileReplacement, "backupPath">): boolean {
  const dir = dirname(path);
  const tmp = `${path}.${process.pid}.${tmpSeq++}.tmp`;
  try {
    mkdirSync(dir, { recursive: true });
    const fd = openSync(tmp, "wx", mode);
    try {
      writeSync(fd, body, 0, "utf8");
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    try {
      linkSync(tmp, path);
    } catch (err) {
      if (typeof err === "object" && err !== null && "code" in err && err.code === "EEXIST")
        return false;
      throw err;
    }
    fsyncDir(dir);
    return true;
  } catch (err) {
    throw mapErr(err, `durable create ${path}`);
  } finally {
    try {
      unlinkSync(tmp);
    } catch {
      // a candidate never written has nothing to remove
    }
  }
}
