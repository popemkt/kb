import type { KbIndex } from "./index.ts";

/** One query as an engine runs it: datalog, and the inputs after `$` its `:in` names. */
export interface QueryRequest {
  readonly edn: string;
  readonly inputs?: readonly unknown[];
  /** How long the run may take, in milliseconds, before its answer is that it took too long. */
  readonly budgetMs: number;
}

/**
 * What an engine said to one query, as of the generation of the index it
 * ran on. A run that took longer than its budget answers `over-budget`,
 * never rows it may not have finished: a slow query is not a large one.
 */
export type QueryAnswer =
  | {
      readonly kind: "rows";
      readonly rows: unknown[][];
      readonly generation: number;
      /**
       * Until when (epoch ms) the rows hold although the graph does not move:
       * set when the run read the clock (`kb/today`, …), so a reader asks
       * again then (`holdsUntil`).
       */
      readonly holdsUntilMs?: number;
    }
  | {
      readonly kind: "error";
      /** The engine's name for what it threw: `DatalogError` when the datalog is wrong. */
      readonly name: string;
      readonly message: string;
      readonly generation: number;
    }
  | { readonly kind: "over-budget"; readonly budgetMs: number; readonly generation: number };

/**
 * How an engine that runs elsewhere is reached: one query, answered
 * whenever, as of the generation it ran at. It never rejects: a query the
 * engine refuses is an `error` answer.
 */
export interface QueryTransport {
  readonly run: (request: QueryRequest) => Promise<QueryAnswer>;
}

/**
 * `request` answered by `index`, as of `generation` (the index's own unless
 * its host numbers generations itself). `now` reads a monotonic clock in
 * milliseconds, so a run that overran its budget answers so even where
 * nothing could stop it.
 */
export function answerOf(
  index: KbIndex,
  request: QueryRequest,
  now: () => number,
  generation: number = index.generation,
): QueryAnswer {
  const started = now();
  try {
    const { rows, holdsUntilMs } = index.answerDatalog(request.edn, ...(request.inputs ?? []));
    if (now() - started > request.budgetMs) {
      return { kind: "over-budget", budgetMs: request.budgetMs, generation };
    }
    return holdsUntilMs === null
      ? { kind: "rows", rows, generation }
      : { kind: "rows", rows, generation, holdsUntilMs };
  } catch (error) {
    return {
      kind: "error",
      name: error instanceof Error ? error.name : "Error",
      message: error instanceof Error ? error.message : String(error),
      generation,
    };
  }
}
