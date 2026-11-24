import { Effect, Stream } from "effect";
import {
  staleCommitError,
  type EffectStore,
  type StoreCommit,
  type StoreFingerprint,
  type TxRecord,
} from "@kb/contracts";
import {
  writesOf,
  rankTx,
  StoreState,
  type DomainError,
  type KbNode,
  type StoreTx,
} from "@kb/model";
import { MemoryTxTail } from "@kb/tx-log";

/** The graph immediately before and after one atomic local store commit. */
export interface LocalCommitChange {
  readonly before: KbNode[];
  readonly after: KbNode[];
  readonly tx: StoreTx;
}

/** In-memory persistence side of the browser's replicated kb session. */
export class BrowserStore implements EffectStore {
  readonly closeEffect = Effect.void;
  readonly path = "browser";
  readonly loadEffect: Effect.Effect<KbNode[], DomainError>;

  /**
   * In memory, because this store is a replica: the server's tail is the
   * durable one, and a second durable copy in the browser would be a record
   * with no authority claiming to be one.
   */
  readonly txTail = new MemoryTxTail();

  private state = new StoreState();
  private generation = 0;
  readonly fingerprint = Effect.sync(() => String(this.generation));
  /**
   * No other instance can write this store — the server pushes it its news —
   * so the current state is all there is to report.
   */
  readonly changes = Stream.fromEffect(this.fingerprint).pipe(Stream.concat(Stream.never));

  constructor(nodes: readonly KbNode[]) {
    this.replace(nodes);
    this.loadEffect = Effect.sync(() => [...this.state.values()]);
  }

  commitEffect(
    tx: StoreTx,
    record: TxRecord,
    expected?: StoreFingerprint,
  ): Effect.Effect<StoreCommit, DomainError> {
    return this.commitWith(tx, record, expected);
  }

  /**
   * An `EffectStore` view of this store that reports each commit it makes
   * with the exact state immediately before and after `apply`, so a caller's
   * undo history sees only its own commits even when writes overlap.
   */
  scoped(onCommit: (change: LocalCommitChange) => void): EffectStore {
    return {
      path: this.path,
      loadEffect: this.loadEffect,
      fingerprint: this.fingerprint,
      changes: this.changes,
      closeEffect: this.closeEffect,
      txTail: this.txTail,
      commitEffect: (tx, record, expected) => this.commitWith(tx, record, expected, onCommit),
    };
  }

  private commitWith(
    tx: StoreTx,
    record: TxRecord,
    expected: StoreFingerprint | undefined,
    onCommit?: (change: LocalCommitChange) => void,
  ): Effect.Effect<StoreCommit, DomainError> {
    return Effect.gen({ self: this }, function* () {
      // Single-threaded and synchronous: nothing can land between the read of
      // the generation and the write that bumps it, or between that and the
      // record — which is what "one critical section" means in a browser.
      const base = String(this.generation);
      const stale = staleCommitError(expected, base);
      if (stale !== null) return yield* stale;
      const before = onCommit === undefined ? null : [...this.state.values()];
      const applied = rankTx(this.state, tx);
      const writes = writesOf(applied, (id) => this.state.get(id));
      this.apply(applied);
      const kept =
        applied.upserts.length > 0 || applied.deletes.length > 0
          ? yield* this.txTail.append(applied, record)
          : null;
      if (onCommit !== undefined && before !== null && kept !== null) {
        onCommit({ before, after: [...this.state.values()], tx: applied });
      }
      return {
        base,
        fingerprint: String(this.generation),
        tx: applied,
        record: kept,
        writes,
      };
    });
  }

  /**
   * Keep the store side current when the replica ingests a server tx. Taken
   * as given: the server's store already settled its ranks.
   */
  apply(tx: StoreTx): void {
    this.state.apply(tx);
    this.generation += 1;
  }

  /** Replace the snapshot after an authoritative server snapshot. */
  replace(nodes: readonly KbNode[]): void {
    this.state = StoreState.of(nodes);
    this.generation += 1;
  }
}
