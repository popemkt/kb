import { Effect, Stream } from "effect";
import {
  staleCommitError,
  type EffectStore,
  type StoreCommit,
  type StoreFingerprint,
  type TxRecord,
} from "@kb/contracts";
import { rankTx, StoreState, type DomainError, type KbNode, type StoreTx } from "@kb/model";
import { MemoryTxTail } from "@kb/tx-log";

/** In-memory persistence side of the browser's replicated kb session. */
export class BrowserStore implements EffectStore {
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
    return Effect.suspend(() => {
      // Single-threaded and synchronous: nothing can land between the read of
      // the generation and the write that bumps it, or between that and the
      // record — which is what "one critical section" means in a browser.
      const base = String(this.generation);
      const stale = staleCommitError(expected, base);
      if (stale !== null) return Effect.fail(stale);
      const applied = rankTx(this.state, tx);
      this.apply(applied);
      if (applied.upserts.length > 0 || applied.deletes.length > 0) {
        this.txTail.append(applied, record);
      }
      return Effect.succeed({ base, fingerprint: String(this.generation), tx: applied });
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
