import { Effect } from "effect";
import { pageLength, type TailSpan, type TxPage, type TxRecord, type TxTail } from "@kb/contracts";
import { canonicalJson, recordedTx, type KbTx, type StoreTx } from "@kb/model";

/**
 * A {@link TxTail} that lives and dies with the process.
 *
 * Not a store's tail: a store's tail is durable by definition, and the two
 * shipped adapters each have one. This is the tail a *store without a file*
 * has — the browser's replicated store, whose authority is the server it is
 * replicating, and a test fixture that wants the log's semantics without a
 * filesystem. Both are stores whose nodes are already somewhere else; a
 * durable tail beside them would be a third copy of a sequence they do not own.
 *
 * `isCurrent` is therefore always true: nothing here can outlive the store it
 * belongs to, so head cannot be stale with respect to it.
 */
export class MemoryTxTail implements TxTail {
  private entriesInOrder: KbTx[] = [];

  head(): number {
    return this.entriesInOrder.at(-1)?.rev ?? 0;
  }

  isCurrent(): boolean {
    return true;
  }

  entries(): KbTx[] {
    return [...this.entriesInOrder];
  }

  since(rev: number, page?: TxPage): KbTx[] {
    const after = this.entriesInOrder.filter((tx) => tx.rev > rev);
    if (page === undefined) return after;
    return after.slice(
      0,
      pageLength(
        after.map((tx) => canonicalJson(tx.ops).length),
        page,
      ),
    );
  }

  /** No store marks to chain: a holder of an older state reads the store it replicates. */
  committedSince(): TailSpan | null {
    return null;
  }

  append(ops: StoreTx, record: TxRecord): Effect.Effect<KbTx> {
    return Effect.sync(() => this.record(ops, record));
  }

  /**
   * {@link append}, done now: the one way an entry is added, for a holder
   * that records inside its own synchronous critical section, where an
   * Effect step would let the scheduler run another fiber in between.
   */
  record(ops: StoreTx, record: TxRecord): KbTx {
    const tx = recordedTx(this.head() + 1, ops, record);
    this.entriesInOrder.push(tx);
    return tx;
  }

  adopt(txs: readonly KbTx[]): Effect.Effect<void> {
    return Effect.sync(() => {
      this.entriesInOrder = [...txs];
    });
  }
}
