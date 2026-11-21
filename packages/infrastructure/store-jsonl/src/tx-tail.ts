import {
  appendFileSync,
  closeSync,
  fsyncSync,
  openSync,
  readFileSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";
import { Effect, Predicate } from "effect";
import {
  canonicalJson,
  decodeStoredTx,
  domainError,
  ensureDomainError,
  recordedTx,
  type DomainError,
  type KbTx,
  type StoreTx,
} from "@kb/model";
import {
  TX_TAIL_KEEP_ENTRIES,
  TX_TAIL_MAX_ENTRIES,
  committedSpan,
  pageLength,
  type TailSpan,
  type TxPage,
  type TxRecord,
  type TxTail,
} from "@kb/contracts";
import {
  acquireFileWriteLockEffect,
  durableReplaceFile,
  releaseFileWriteLock,
} from "@kb/file-write";
import { contentMark, storeMark } from "./content-mark.ts";

interface TailRecord {
  readonly tx: KbTx;
  /** The store's mark once the record's transaction was published. */
  readonly mark: string;
  /** The mark it began on; null on a record an earlier kb wrote, or one adopted. */
  readonly base: string | null;
  readonly bytes: number;
}

interface History {
  readonly key: string | null;
  readonly records: readonly TailRecord[];
  readonly complete: boolean;
}

function lineOf(tx: KbTx, mark: string, base: string | null): string {
  return `${canonicalJson(base === null ? { ...tx, mark } : { ...tx, mark, base })}\n`;
}

function stringAt(raw: unknown, key: "mark" | "base"): string | null {
  return Predicate.hasProperty(raw, key) && typeof raw[key] === "string" ? raw[key] : null;
}

function decodeLine(line: string): TailRecord {
  const raw: unknown = JSON.parse(line);
  return {
    tx: decodeStoredTx(raw),
    mark: stringAt(raw, "mark") ?? "",
    base: stringAt(raw, "base"),
    bytes: Buffer.byteLength(line) + 1,
  };
}

function addRecord(history: readonly TailRecord[], pending: TailRecord): TailRecord[] {
  const retained =
    history.length < TX_TAIL_MAX_ENTRIES ? history : history.slice(-(TX_TAIL_KEEP_ENTRIES - 1));
  return [...retained, pending];
}

function missing(err: unknown): boolean {
  return Predicate.hasProperty(err, "code") && err.code === "ENOENT";
}

/** Include inode identity for replacement and ctime for same-size in-place edits. */
function fileKey(path: string): string | null {
  try {
    const { ino, dev, size, ctimeNs } = statSync(path, { bigint: true });
    return `${dev}:${ino}:${size}:${ctimeNs}`;
  } catch (err) {
    if (missing(err)) return null;
    throw err;
  }
}

export function txTailPath(root: string): string {
  return join(root, ".kb", "tx.jsonl");
}

/**
 * The JSONL tail is archived history plus at most one journaled record. The
 * graph replacement publishes that record (DESIGN.md → The transaction tail).
 * Every mutation runs under the node writer lock, including virtual writes.
 */
export class JsonlTxTail implements TxTail {
  readonly path: string;
  readonly backupPath: string;
  readonly pendingPath: string;
  private readonly nodesPath: string;
  private cache: History | null = null;

  constructor(nodesPath: string, path: string) {
    this.nodesPath = nodesPath;
    this.path = path;
    this.backupPath = `${path}.bak`;
    this.pendingPath = `${path}.pending`;
  }

  withWriter<A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E | DomainError, R> {
    return Effect.scoped(
      Effect.gen({ self: this }, function* () {
        yield* Effect.acquireRelease(acquireFileWriteLockEffect(this.nodesPath), (lock) =>
          Effect.sync(() => releaseFileWriteLock(lock)),
        );
        return yield* effect;
      }),
    );
  }

  head(): number {
    return this.published().records.at(-1)?.tx.rev ?? 0;
  }

  isCurrent(): boolean {
    const { records, mark } = this.published();
    return (
      (records.at(-1)?.mark ?? contentMark("")) ===
      (mark === undefined ? storeMark(this.nodesPath) : mark)
    );
  }

  entries(): KbTx[] {
    return this.published().records.map((record) => record.tx);
  }

  committedSince(from: string): TailSpan | null {
    const { records, mark } = this.published();
    // Read after the records, so a commit published between the two ends
    // the span short of `to` and answers null rather than missing it.
    const to = mark === undefined ? storeMark(this.nodesPath) : mark;
    if (to === null) return null;
    return committedSpan(
      records.map((record) => ({ base: record.base, mark: record.mark, ops: () => record.tx.ops })),
      from,
      to,
    );
  }

  since(rev: number, page?: TxPage): KbTx[] {
    const after = this.published().records.filter((record) => record.tx.rev > rev);
    if (page === undefined) return after.map((record) => record.tx);
    const count = pageLength(
      after.map((record) => record.bytes),
      page,
    );
    return after.slice(0, count).map((record) => record.tx);
  }

  append(ops: StoreTx, record: TxRecord): Effect.Effect<KbTx, DomainError> {
    return this.withWriter(
      Effect.try({
        try: () => {
          const mark = this.readStoreMark();
          return this.transact(ops, record, mark, mark);
        },
        catch: ensureDomainError,
      }),
    );
  }

  /** Stage and publish inside the writer lock. A virtual write has no node replacement. */
  transact(ops: StoreTx, record: TxRecord, base: string, mark: string, publish?: () => void): KbTx {
    const rev = this.archivePending(base) + 1;
    const tx = recordedTx(rev, ops, record);
    durableReplaceFile({ path: this.pendingPath, body: lineOf(tx, mark, base) });
    publish?.();
    // The commit is already visible. If this cleanup cannot finish, readers
    // use the journal and the next writer must finish it before reusing it.
    try {
      this.archivePending(mark);
      unlinkSync(this.pendingPath);
    } catch {
      // The staged record remains recoverable.
      // GAP [[01M7Q21QJJWSB6JBZPW3EWT6K8]]: older writers cannot read it.
    }
    return tx;
  }

  adopt(txs: readonly KbTx[]): Effect.Effect<void, DomainError> {
    return this.withWriter(
      Effect.try({
        try: () => {
          const mark = this.readStoreMark();
          this.archivePending(mark);
          durableReplaceFile({ path: this.pendingPath, body: "" });
          this.writeHistory(
            txs.slice(-TX_TAIL_KEEP_ENTRIES).map((tx) => ({
              tx,
              mark,
              base: null,
              bytes: Buffer.byteLength(lineOf(tx, mark, null)),
            })),
          );
        },
        catch: ensureDomainError,
      }),
    );
  }

  /**
   * Read history before the pending record, then verify the history key. A
   * writer can replace the journal only after archiving the previous record.
   * Retrying a changed history avoids missing that record during handoff.
   */
  private published(): { records: readonly TailRecord[]; mark?: string | null } {
    try {
      for (;;) {
        const history = this.history();
        const pending = this.pending();
        const records = history.records;
        const unpublished =
          pending !== undefined && pending.tx.rev > (records.at(-1)?.tx.rev ?? 0)
            ? pending
            : undefined;
        const mark = unpublished === undefined ? undefined : storeMark(this.nodesPath);
        if (history.key !== fileKey(this.path)) continue;
        if (unpublished !== undefined && unpublished.mark === mark)
          return { records: addRecord(records, unpublished), mark };
        return mark === undefined ? { records } : { records, mark };
      }
    } catch {
      // A damaged tail requires a snapshot. It must not prevent reading nodes.
      return { records: this.cache?.records ?? [], mark: null };
    }
  }

  private readStoreMark(): string {
    const mark = storeMark(this.nodesPath);
    if (mark === null) throw domainError("internal", `cannot read node mark for ${this.nodesPath}`);
    return mark;
  }

  private pending(): TailRecord | undefined {
    let body: string;
    try {
      body = readFileSync(this.pendingPath, "utf8");
    } catch (err) {
      if (missing(err)) return undefined;
      throw err;
    }
    return body.length === 0 ? undefined : decodeLine(body.slice(0, -1));
  }

  private history(): History {
    const key = fileKey(this.path);
    if (this.cache?.key === key) return this.cache;
    if (key === null) return { key, records: [], complete: true };
    const lines = readFileSync(this.path, "utf8").split("\n");
    const records: TailRecord[] = [];
    const complete = lines.pop() === "";
    for (const line of lines) {
      if (line.trim().length === 0) continue;
      try {
        records.push(decodeLine(line));
      } catch {
        const history = { key, records, complete: false };
        this.cache = history;
        return history;
      }
    }
    const history = { key, records, complete };
    this.cache = history;
    return history;
  }

  /**
   * Preserve the journal before reusing it. A crash during archive can leave
   * a partial line, or a full line whose fsync did not run. The former is
   * replaced from the committed prefix and the latter still needs a sync.
   */
  private archivePending(mark: string): number {
    const history = this.history();
    const last = history.records.at(-1)?.tx.rev ?? 0;
    const pending = this.pending();
    if (pending === undefined || pending.mark !== mark || pending.tx.rev < last) return last;
    if (pending.tx.rev === last) {
      this.syncHistory("", history.records);
      return last;
    }
    const records = addRecord(history.records, pending);
    if (history.complete && history.records.length < TX_TAIL_MAX_ENTRIES) {
      this.syncHistory(lineOf(pending.tx, pending.mark, pending.base), records);
    } else {
      this.writeHistory(records);
    }
    return pending.tx.rev;
  }

  private syncHistory(line: string, records: readonly TailRecord[]): void {
    const fd = openSync(this.path, "a");
    try {
      if (line !== "") appendFileSync(fd, line);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
      this.cache = null;
    }
    this.cache = { key: fileKey(this.path), records, complete: true };
  }

  private writeHistory(records: readonly TailRecord[]): void {
    const body = records.map((record) => lineOf(record.tx, record.mark, record.base)).join("");
    this.cache = null;
    durableReplaceFile({ path: this.path, backupPath: this.backupPath, body });
    this.cache = { key: fileKey(this.path), records, complete: true };
  }
}
