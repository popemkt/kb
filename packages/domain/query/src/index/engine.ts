import { Context, Effect, Schema } from "effect";
import { domainError, type DomainError } from "@kb/model";
import { DatalogError } from "../datalog-error.ts";
import type { KbIndex } from "./index.ts";

/**
 * A query the engine could not answer. `cause` is what it threw: a
 * `DatalogError` when the caller's datalog is wrong, anything else when kb's
 * own glue failed; {@link classifyQueryError} tells them
 * apart.
 */
export class QueryError extends Schema.TaggedError<QueryError>()("QueryError", {
  cause: Schema.Defect(),
}) {}

/**
 * The datalog half of an index, as an Effect: what an action that may run on
 * the page as well as on the server asks of the graph. A host whose engine
 * runs in process answers at once ({@link engineOf}); one whose engine runs
 * elsewhere (the page's, in a worker) answers when it has. Point reads are
 * the `NodeIndex`'s, which every host keeps where its writes run.
 */
export interface QueryEngine {
  /** Raw datalog in the engine's dialect, as rows (`KbIndex.runDatalog`). */
  readonly runDatalog: (
    edn: string,
    inputs?: ReadonlyArray<unknown>,
  ) => Effect.Effect<Array<Array<unknown>>, QueryError>;
}

export class QueryEngineService extends Context.Service<QueryEngineService, QueryEngine>()(
  "kb/QueryEngine",
) {}

/**
 * Map a query-layer failure to a typed domain error. Datalog errors thrown by
 * the datascript engine (parse/eval of the user's EDN) are `invalid_input`;
 * anything else — a genuine defect in our glue (normalization, revive) — stays
 * `internal` so internal bugs are never hidden behind an "invalid query" code.
 */
export function classifyQueryError(err: unknown, queryString: string): DomainError {
  if (err instanceof DatalogError) {
    return domainError("invalid_input", `invalid datalog query: ${err.message}`, {
      query: queryString,
    });
  }
  return domainError(
    "internal",
    `graph query failed: ${err instanceof Error ? err.message : String(err)}`,
    { query: queryString },
  );
}

/**
 * Datalog on whichever engine the host runs, its failure as a typed domain
 * error ({@link classifyQueryError}): what `graph.query` and `graph.run` answer,
 * and what a family reads the graph with.
 */
export const datalogRows = Effect.fn("datalogRows")(function* (
  edn: string,
  inputs?: unknown[],
): Effect.fn.Return<unknown[][], DomainError, QueryEngineService> {
  const engine = yield* QueryEngineService;
  return yield* engine
    .runDatalog(edn, inputs)
    .pipe(Effect.mapError(({ cause }) => classifyQueryError(cause, edn)));
});

/** The engine of an index that runs in this process: each answer is the index's own, at once. */
export function engineOf(index: KbIndex): QueryEngine {
  return {
    runDatalog: (edn, inputs = []) =>
      Effect.try({
        try: () => index.runDatalog(edn, ...inputs),
        catch: (cause) => new QueryError({ cause }),
      }),
  };
}

/** A synchronous datalog runner, as the pure readers of `@kb/model` take one. */
export type EdnRunner = (edn: string) => unknown[][];

/** How many rounds a reader may take to name every query it asks before it is a defect. */
const MAX_ROUNDS = 64;

/** One query's answer as a synchronous runner gives it back: its rows, or what it threw. */
type Answer = { readonly rows: unknown[][] } | { readonly threw: unknown };

/**
 * What `read` answers when its queries are run on `engine`.
 *
 * A pure reader (`resolveOntology`, `allowedRefIdsOf`, …) takes a
 * synchronous runner and may decide its next query from the last one's
 * rows. This runs it against any engine: each round it reads with the
 * answers so far (an unanswered query reads as no rows), asks the engine
 * for the queries it named and had no answer to, and reads again, until a
 * round names nothing new. A query the engine refused throws, in later
 * rounds, what the engine threw, as an in-process runner would. Only the
 * last round's value is returned, so what the reader made of a missing
 * answer never escapes.
 */
export const answered = Effect.fn("answered")(function* <T>(
  read: (run: EdnRunner) => T,
  engine: QueryEngine,
): Effect.fn.Return<T> {
  const answers = new Map<string, Answer>();
  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    const missing = new Set<string>();
    const value = read((edn) => {
      const answer = answers.get(edn);
      if (answer === undefined) {
        missing.add(edn);
        return [];
      }
      if ("threw" in answer) throw answer.threw;
      return answer.rows;
    });
    if (missing.size === 0) return value;
    for (const edn of missing) {
      const answer = yield* engine.runDatalog(edn).pipe(
        Effect.map((rows): Answer => ({ rows })),
        Effect.catch(({ cause }) => Effect.succeed<Answer>({ threw: cause })),
      );
      answers.set(edn, answer);
    }
  }
  return yield* Effect.die(new Error(`a reader named new queries for ${MAX_ROUNDS} rounds`));
});
