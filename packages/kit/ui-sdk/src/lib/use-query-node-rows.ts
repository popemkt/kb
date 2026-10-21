import { useEffect, useId, useState } from "react";
import type { QueryRead } from "./replica-queries";
import type { NodeMap } from "./types";

/** Where a query node's subscribed rows go. */
interface QueryRowsSink {
  readonly rows: (rows: unknown[][]) => void;
  readonly error: (error: { readonly message: string }) => void;
}

/**
 * Subscribe a query node's rows as one subscriber (`querySubscriptionId`);
 * returns the unsubscribe. The page binds it to its live socket.
 */
export type QueryRowsSubscribe = (
  nodeId: string,
  subscriber: string,
  edn: string,
  sink: QueryRowsSink,
) => () => void;

export interface QueryNodeRows {
  rows: unknown[][] | null;
  error: string | null;
}

/**
 * The rows an expanded query node currently has, from whichever source can
 * answer: a /ws subscription while the socket is open, the replica's answer
 * otherwise (`local`, read by the caller through `useQueryAnswer`, which
 * keeps it live as the replica moves).
 *
 * Both halves live here rather than in the component that renders them. A
 * surface renders what it is given; opening and closing a server subscription
 * is transport lifecycle, and running datalog belongs above the query seam
 * (`query.ts`) — `@kb/model`'s `query-node.ts` stays pure system-node
 * modeling, and this is the one place that turns a query node's EDN into
 * rows, and its rows into the nodes they name (`resultNodeIds`).
 */
export function useQueryNodeRows(input: {
  nodeId: string;
  edn: string | null;
  /** Subscribe instead of querying locally — true while /ws is open. */
  live: boolean;
  /** How to subscribe while live. */
  subscribe: QueryRowsSubscribe;
  /** The replica's answer to `edn`, read while not live. */
  local: QueryRead;
}): QueryNodeRows {
  const { nodeId, edn, local, subscribe } = input;
  const liveEdn = input.live ? edn : null;
  // Each caller holds its own subscription (`querySubscriptionId`).
  const subscriber = useId();

  const [liveRows, setLiveRows] = useState<unknown[][] | null>(null);
  const [liveError, setLiveError] = useState<string | null>(null);

  useEffect(() => {
    if (liveEdn === null) return undefined;
    const unsubscribe = subscribe(nodeId, subscriber, liveEdn, {
      rows: (rows) => {
        setLiveRows(rows);
        setLiveError(null);
      },
      error: ({ message }) => {
        setLiveRows(null);
        setLiveError(message);
      },
    });
    return () => {
      unsubscribe();
      setLiveRows(null);
      setLiveError(null);
    };
  }, [liveEdn, nodeId, subscriber, subscribe]);

  if (liveEdn !== null) return { rows: liveRows, error: liveError };
  const { answer } = local;
  if (edn === null || answer === null) return { rows: null, error: null };
  return answer.kind === "rows"
    ? { rows: answer.rows, error: null }
    : { rows: null, error: answer.message };
}

/**
 * Map raw datalog rows to result node ids: first column value per row that
 * names a known node. Dedupes, drops the query node itself, applies limit.
 */
export function resultNodeIds(
  rows: unknown[][],
  nodes: NodeMap,
  opts: { limit?: number | null; excludeId?: string } = {},
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const limit = opts.limit ?? null;
  for (const row of rows) {
    const id = row.find((v): v is string => typeof v === "string" && nodes.has(v));
    if (id === undefined || seen.has(id) || id === opts.excludeId) continue;
    seen.add(id);
    out.push(id);
    if (limit !== null && out.length >= limit) break;
  }
  return out;
}
