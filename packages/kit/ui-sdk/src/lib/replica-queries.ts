/**
 * The page's datalog reads, answered by the replica's engine wherever it
 * runs (DESIGN-UI.md → Replica queries).
 *
 * The engine answers a query in its own time, so a reader never blocks on
 * one: it reads the last answer the page has for that query and is told when
 * a newer one arrives. One answer per query text serves every reader of it,
 * so the results under a query node and the count beside it are one
 * execution, and a query asked twice before it is answered is asked once.
 *
 * An answer is as of a generation of the replica. A query someone watches is
 * asked again when the generation moves, and until the new answer arrives its
 * readers keep the last one (it is not `current`), so a write never blanks
 * what the page shows. A query no one watches is asked again only when it is
 * read, and forgotten once enough others have been read since.
 */
import type { EdnRunner, KbIndex } from "@kb/query";

/** What the engine said to one query, as of the generation it answered at. */
export type QueryAnswer =
  | { readonly kind: "rows"; readonly rows: unknown[][]; readonly generation: number }
  | {
      readonly kind: "error";
      /** The engine's name for what it threw: `DatalogError` when the datalog is wrong. */
      readonly name: string;
      readonly message: string;
      readonly generation: number;
    };

/** One query as the engine runs it: datalog, and the inputs after `$` its `:in` names. */
export interface QueryRequest {
  readonly edn: string;
  readonly inputs?: readonly unknown[];
}

/**
 * How the engine is reached: one query, asked when the replica is at
 * `generation`, answered whenever, as of the generation it ran at. It never
 * rejects: a query the engine refuses is an `error` answer.
 */
export interface QueryTransport {
  readonly run: (request: QueryRequest, generation: number) => Promise<QueryAnswer>;
}

/** `request` answered by `index`, as of the generation it stands at. */
export function answerOf(index: KbIndex, request: QueryRequest): QueryAnswer {
  const generation = index.generation;
  try {
    return {
      kind: "rows",
      rows: index.runDatalog(request.edn, ...(request.inputs ?? [])),
      generation,
    };
  } catch (error) {
    return {
      kind: "error",
      name: error instanceof Error ? error.name : "Error",
      message: error instanceof Error ? error.message : String(error),
      generation,
    };
  }
}

/** The transport of an engine in this thread: each query answered on the turn after it is asked. */
export function inThreadTransport(index: KbIndex): QueryTransport {
  return { run: (request) => Promise.resolve().then(() => answerOf(index, request)) };
}

/**
 * A query's answer as a reader finds it: the last one (null before any) and
 * whether it is as of the replica now. The same object until either moves,
 * so it is a snapshot a React store can compare.
 */
export interface QueryRead {
  readonly answer: QueryAnswer | null;
  readonly current: boolean;
}

interface Entry {
  answer: QueryAnswer | null;
  read: QueryRead;
  /** The generation an ask is out for, if one is. */
  asking: number | null;
  /** Who keeps this query live: asked again when the generation moves. */
  watchers: number;
  /** Who waits for the answer as of a generation (`ask`). */
  waiting: Array<{ readonly generation: number; readonly settle: (answer: QueryAnswer) => void }>;
  readonly listeners: Set<() => void>;
}

/** A refused answer, thrown as an in-process runner would throw it. */
class AnsweredError extends Error {
  constructor(answer: Extract<QueryAnswer, { kind: "error" }>) {
    super(answer.message);
    this.name = answer.name;
  }
}

/** How many rounds `settle` lets a reader take to name every query it asks before it is a defect. */
const MAX_ROUNDS = 64;

/** How many queries no one watches the page keeps the last answer of. */
const KEPT_UNWATCHED = 256;

const NOT_ASKED: QueryRead = { answer: null, current: false };

/** The page's query answers as their readers use them: what {@link ReplicaQueries} is to a reader. */
export interface QueryAnswers {
  readonly version: number;
  subscribe(listener: () => void): () => void;
  subscribeTo(edn: string, listener: () => void): () => void;
  read(edn: string): QueryRead;
  watch(edn: string): () => void;
  moved(): void;
  once(request: QueryRequest): Promise<QueryAnswer>;
  ask(edn: string): Promise<QueryAnswer>;
  runner(reads?: Map<string, QueryRead>): EdnRunner;
  settle<T>(read: (run: EdnRunner) => T): Promise<T>;
}

export class ReplicaQueries implements QueryAnswers {
  readonly #transport: QueryTransport;
  readonly #generation: () => number;
  /** In the order they were last read, oldest first. */
  readonly #entries = new Map<string, Entry>();
  readonly #listeners = new Set<() => void>();
  #version = 0;

  constructor(transport: QueryTransport, generation: () => number) {
    this.#transport = transport;
    this.#generation = generation;
  }

  /** Bumps whenever any answer arrives: what a reader of many queries compares. */
  get version(): number {
    return this.#version;
  }

  /** Listen for any answer arriving; returns the unsubscribe. */
  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Listen for an answer to `edn` arriving; returns the unsubscribe. */
  subscribeTo(edn: string, listener: () => void): () => void {
    const entry = this.#entry(edn);
    entry.listeners.add(listener);
    return () => entry.listeners.delete(listener);
  }

  /** The last answer to `edn`, asking for the current one when the page has not got it. */
  read(edn: string): QueryRead {
    const entry = this.#entry(edn);
    const generation = this.#generation();
    const current = entry.answer?.generation === generation;
    if (entry.read.current !== current || entry.read.answer !== entry.answer) {
      entry.read = { answer: entry.answer, current };
    }
    if (!current) this.#askLater(edn, entry);
    return entry.read;
  }

  /** Keep `edn` live until the returned release: asked again whenever the generation moves. */
  watch(edn: string): () => void {
    const entry = this.#entry(edn);
    entry.watchers += 1;
    this.read(edn);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      entry.watchers -= 1;
    };
  }

  /** The replica moved: ask every watched query again. */
  moved(): void {
    for (const [edn, entry] of this.#entries) {
      if (entry.watchers > 0) this.#askLater(edn, entry);
    }
  }

  /**
   * `request` answered once, as of now, outside the cache: a query with
   * inputs, which no reader shares (an action's `graph.query`).
   */
  once(request: QueryRequest): Promise<QueryAnswer> {
    return this.#transport.run(request, this.#generation());
  }

  /** The answer to `edn` as of the current generation, when it arrives. */
  ask(edn: string): Promise<QueryAnswer> {
    const entry = this.#entry(edn);
    const generation = this.#generation();
    if (entry.answer !== null && entry.answer.generation >= generation) {
      return Promise.resolve(entry.answer);
    }
    return new Promise((settle) => {
      entry.waiting.push({ generation, settle });
      this.#askNow(edn, entry);
    });
  }

  /**
   * A synchronous runner over the answers the page has: a query's last rows,
   * a thrown error for a refused one, no rows for one never answered. Each
   * query it reads is asked for when not current, and named in `reads` when
   * given, so a caller can watch what it read.
   */
  runner(reads?: Map<string, QueryRead>): EdnRunner {
    return (edn) => {
      const read = this.read(edn);
      reads?.set(edn, read);
      const { answer } = read;
      if (answer === null) return [];
      if (answer.kind === "error") throw new AnsweredError(answer);
      return answer.rows;
    };
  }

  /**
   * What `read` answers once every query it asks is answered as of now: the
   * page's `answered` (`@kb/query`). Each round reads with the answers so far
   * and waits for the queries it named that are not current, until a round
   * names none.
   */
  settle<T>(read: (run: EdnRunner) => T): Promise<T> {
    return this.#settleFrom(read, 0);
  }

  /** One round of `settle`: read, and if it named queries that are not current, wait and read again. */
  async #settleFrom<T>(read: (run: EdnRunner) => T, round: number): Promise<T> {
    if (round >= MAX_ROUNDS) throw new Error(`a reader named new queries for ${MAX_ROUNDS} rounds`);
    const reads = new Map<string, QueryRead>();
    const value = read(this.runner(reads));
    const stale = [...reads].flatMap(([edn, at]) => (at.current ? [] : [edn]));
    if (stale.length === 0) return value;
    await Promise.all(stale.map((edn) => this.ask(edn)));
    return this.#settleFrom(read, round + 1);
  }

  #entry(edn: string): Entry {
    const known = this.#entries.get(edn);
    if (known !== undefined) {
      this.#entries.delete(edn);
      this.#entries.set(edn, known);
      return known;
    }
    const entry: Entry = {
      answer: null,
      read: NOT_ASKED,
      asking: null,
      watchers: 0,
      waiting: [],
      listeners: new Set(),
    };
    this.#entries.set(edn, entry);
    this.#forget();
    return entry;
  }

  /** Drop the least recently read queries no one watches, waits for or listens to. */
  #forget(): void {
    let spare = this.#entries.size - KEPT_UNWATCHED;
    for (const [edn, entry] of this.#entries) {
      if (spare <= 0) return;
      const held =
        entry.watchers > 0 ||
        entry.waiting.length > 0 ||
        entry.listeners.size > 0 ||
        entry.asking !== null;
      if (held) continue;
      this.#entries.delete(edn);
      spare -= 1;
    }
  }

  /** Ask after the caller's turn: a read during a render starts nothing until it is over. */
  #askLater(edn: string, entry: Entry): void {
    if (entry.asking === this.#generation()) return;
    queueMicrotask(() => this.#askNow(edn, entry));
  }

  #askNow(edn: string, entry: Entry): void {
    const generation = this.#generation();
    if (entry.asking === generation) return;
    if (entry.answer !== null && entry.answer.generation >= generation) return;
    entry.asking = generation;
    void this.#transport.run({ edn }, generation).then(
      (answer) => this.#land(entry, answer),
      (error: unknown) =>
        this.#land(entry, {
          kind: "error",
          name: error instanceof Error ? error.name : "Error",
          message: error instanceof Error ? error.message : String(error),
          generation,
        }),
    );
  }

  #land(entry: Entry, answer: QueryAnswer): void {
    if (entry.asking !== null && entry.asking <= answer.generation) entry.asking = null;
    if (entry.answer !== null && entry.answer.generation > answer.generation) return;
    entry.answer = answer;
    const ready = entry.waiting.filter((w) => w.generation <= answer.generation);
    entry.waiting = entry.waiting.filter((w) => w.generation > answer.generation);
    for (const waiter of ready) waiter.settle(answer);
    this.#version += 1;
    for (const listener of entry.listeners) listener();
    for (const listener of this.#listeners) listener();
  }
}
