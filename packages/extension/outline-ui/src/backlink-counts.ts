import { useCallback, useSyncExternalStore } from "react";
import { BACKLINK_COUNTS_QUERY, type QueryAnswers, useReplicaQueries } from "@kb/ui-sdk";

/** One count index and one live query for the replica, shared by its mounted counters. */
class BacklinkCounts {
  readonly #queries: QueryAnswers;
  readonly #listeners = new Map<string, Set<() => void>>();
  #counts = new Map<string, number>();
  #rows: unknown[][] | null = null;
  #disconnect: (() => void) | null = null;

  constructor(queries: QueryAnswers) {
    this.#queries = queries;
  }

  count(id: string): number {
    return this.#counts.get(id) ?? 0;
  }

  subscribe(id: string, listener: () => void): () => void {
    const group = this.#listeners.get(id) ?? new Set<() => void>();
    this.#listeners.set(id, group);
    group.add(listener);

    if (this.#disconnect === null) {
      const unsubscribe = this.#queries.subscribeTo(BACKLINK_COUNTS_QUERY, this.#refresh);
      const unwatch = this.#queries.watch(BACKLINK_COUNTS_QUERY);
      this.#disconnect = () => {
        unsubscribe();
        unwatch();
      };
      this.#refresh();
    }

    return () => {
      group.delete(listener);
      if (group.size === 0) this.#listeners.delete(id);
      if (this.#listeners.size === 0) {
        this.#disconnect?.();
        this.#disconnect = null;
      }
    };
  }

  #refresh = () => {
    const { answer } = this.#queries.read(BACKLINK_COUNTS_QUERY);
    const rows = answer?.kind === "rows" ? answer.rows : null;
    if (rows === this.#rows) return;
    this.#rows = rows;

    const before = this.#counts;
    const next = new Map<string, number>();
    for (const [id, count] of rows ?? []) {
      if (typeof id === "string" && typeof count === "number") next.set(id, count);
    }
    this.#counts = next;
    for (const [id, listeners] of this.#listeners) {
      if (before.get(id) === next.get(id)) continue;
      for (const listener of listeners) listener();
    }
  };
}

const indexes = new WeakMap<QueryAnswers, BacklinkCounts>();

function countsFor(queries: QueryAnswers): BacklinkCounts {
  const known = indexes.get(queries);
  if (known !== undefined) return known;
  const index = new BacklinkCounts(queries);
  indexes.set(queries, index);
  return index;
}

/** An id's count, subscribed only to changes to its own value. */
export function useBacklinkCount(id: string): number {
  const queries = useReplicaQueries();
  const index = queries === null ? null : countsFor(queries);
  const subscribe = useCallback(
    (listener: () => void) => index?.subscribe(id, listener) ?? (() => undefined),
    [id, index],
  );
  const snapshot = () => index?.count(id) ?? 0;
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
