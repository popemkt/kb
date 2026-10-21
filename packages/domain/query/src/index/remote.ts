/**
 * An index whose query engine runs somewhere else — the page's, in a Web
 * Worker (DESIGN-UI.md → Replica queries). The host keeps the node set and
 * its point reads (`NodeTable`) where its writes run, and the engine (a
 * `DatascriptIndex`) behind a port; every mutation goes to both, in order,
 * so a query asked after a write is answered over it.
 *
 * A run is budgeted: the engine cannot be interrupted mid-query, so the host
 * starts a run's clock when the engine says it began, and when the budget
 * runs out it stops the engine whole, answers that run `over-budget`, and
 * starts a fresh engine over the node set it holds, to which every other run
 * still out is asked again. The engine also answers `over-budget` for a run
 * that overran where nothing stopped it (`answerOf`), so the answer is the
 * same on any port.
 */
import type { KbNode, StoreTx } from "@kb/model";
import { answerOf, type QueryAnswer, type QueryRequest, type QueryTransport } from "./answer.ts";
import { DatascriptIndex } from "./datascript-index.ts";
import type { DerivedRef } from "./derived.ts";
import type { NodeIndex } from "./index.ts";
import { NodeTable } from "./node-table.ts";

/** What the host tells the engine. Every mutation carries the generation the host numbers it with. */
export type ToEngine =
  | {
      readonly op: "load";
      readonly nodes: readonly KbNode[];
      readonly virtual: readonly KbNode[];
      readonly generation: number;
    }
  | { readonly op: "tx"; readonly tx: StoreTx; readonly generation: number }
  | { readonly op: "rebuild"; readonly nodes: readonly KbNode[]; readonly generation: number }
  | { readonly op: "virtual"; readonly nodes: readonly KbNode[]; readonly generation: number }
  | { readonly op: "query"; readonly id: number; readonly request: QueryRequest };

/** What the engine tells the host: a run began, or what it answered. */
export type FromEngine =
  | { readonly op: "started"; readonly id: number }
  | { readonly op: "answer"; readonly id: number; readonly answer: QueryAnswer };

/**
 * The engine's side of the port: what it does with each message, posting
 * what it says through `post`. A Web Worker's entry hands it its messages;
 * a host in one thread can hand them to it directly.
 */
export function serveIndex(
  derived: readonly DerivedRef[],
  post: (message: FromEngine) => void,
  now: () => number,
): (message: ToEngine) => void {
  let index = new DatascriptIndex([], { derived });
  let generation = 0;
  return (message) => {
    switch (message.op) {
      case "load":
        index = new DatascriptIndex(message.nodes, { derived });
        if (message.virtual.length > 0) index.withVirtual(message.virtual);
        generation = message.generation;
        return;
      case "tx":
        index.applyTx(message.tx);
        generation = message.generation;
        return;
      case "rebuild":
        index.rebuild(message.nodes);
        generation = message.generation;
        return;
      case "virtual":
        index.withVirtual(message.nodes);
        generation = message.generation;
        return;
      case "query":
        post({ op: "started", id: message.id });
        post({
          op: "answer",
          id: message.id,
          answer: answerOf(index, message.request, now, generation),
        });
        return;
      default:
        message satisfies never;
    }
  };
}

/** The engine as the host holds it: in a Web Worker (`workerPort` on the page), or in this thread. */
export interface EnginePort {
  /** Tell the engine `message`; it takes them in order. */
  send(message: ToEngine): void;
  /** Hear what the engine says, and that it failed outside any one run. The host listens once. */
  listen(hear: (message: FromEngine) => void, failed: () => void): void;
  /** Stop the engine, whatever it is doing. */
  terminate(): void;
}

/** How a host's timers are set (the page's `setTimeout`, or a test's): each returns its cancel. */
export interface Timers {
  readonly set: (run: () => void, ms: number) => () => void;
}

interface Run {
  readonly request: QueryRequest;
  readonly generation: number;
  readonly settle: (answer: QueryAnswer) => void;
  /** Cancels the run's budget, once it has started. */
  cancel: (() => void) | null;
}

/**
 * The host's side: a {@link NodeIndex} over the node set it keeps, and the
 * {@link QueryTransport} of the engine behind `spawn`'s port.
 */
export class RemoteIndex implements NodeIndex {
  readonly #table: NodeTable;
  readonly #spawn: () => EnginePort;
  readonly #timers: Timers;
  #port: EnginePort;
  #closed = false;
  #next = 0;
  readonly #runs = new Map<number, Run>();
  /** How many times the engine has been started again: after an overrun, or a failure. */
  restarts = 0;

  readonly transport: QueryTransport = {
    run: (request) =>
      new Promise((settle) => {
        const run: Run = { request, generation: this.generation, settle, cancel: null };
        if (this.#closed) {
          settle(this.#stopped(run, "closed"));
          return;
        }
        const id = (this.#next += 1);
        this.#runs.set(id, run);
        this.#port.send({ op: "query", id, request });
      }),
  };

  constructor(
    nodes: ReadonlyArray<KbNode>,
    derived: readonly DerivedRef[],
    spawn: () => EnginePort,
    timers: Timers,
  ) {
    this.#table = new NodeTable(nodes, derived);
    this.#spawn = spawn;
    this.#timers = timers;
    this.#port = this.#start();
  }

  get generation(): number {
    return this.#table.generation;
  }

  rebuild(nodes: ReadonlyArray<KbNode>): void {
    this.#table.rebuild(nodes);
    this.#tell({ op: "rebuild", nodes: [...nodes], generation: this.generation });
  }

  applyTx(tx: StoreTx): void {
    if (this.#table.change(tx) === null) return;
    this.#tell({ op: "tx", tx, generation: this.generation });
  }

  withVirtual(nodes: ReadonlyArray<KbNode>): void {
    this.#table.withVirtual(nodes);
    this.#tell({ op: "virtual", nodes: [...nodes], generation: this.generation });
  }

  /** Tell the engine a change; a closed index's table moves alone, as nothing will ask it. */
  #tell(message: ToEngine): void {
    if (!this.#closed) this.#port.send(message);
  }

  getNode(...args: Parameters<NodeIndex["getNode"]>): ReturnType<NodeIndex["getNode"]> {
    return this.#table.getNode(...args);
  }

  referencesOf(
    ...args: Parameters<NodeIndex["referencesOf"]>
  ): ReturnType<NodeIndex["referencesOf"]> {
    return this.#table.referencesOf(...args);
  }

  allNodes(): ReturnType<NodeIndex["allNodes"]> {
    return this.#table.allNodes();
  }

  storedNodes(): ReturnType<NodeIndex["storedNodes"]> {
    return this.#table.storedNodes();
  }

  search(...args: Parameters<NodeIndex["search"]>): ReturnType<NodeIndex["search"]> {
    return this.#table.search(...args);
  }

  /**
   * Stop the engine for good: every run still out, and every one asked
   * after, answers that it stopped.
   */
  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#port.terminate();
    for (const [id, run] of this.#runs) this.#answer(id, this.#stopped(run, "closed"));
  }

  /**
   * A fresh engine over the node set the host holds: the table's stored
   * nodes and the virtual ones still standing, so a restart sees exactly
   * what the table does.
   */
  #start(): EnginePort {
    const port = this.#spawn();
    port.listen(
      (message) => this.#hear(port, message),
      () => this.#failed(port),
    );
    port.send({
      op: "load",
      nodes: this.#table.storedNodes(),
      virtual: [...this.#table.virtualNodes()],
      generation: this.generation,
    });
    return port;
  }

  #hear(port: EnginePort, message: FromEngine): void {
    if (port !== this.#port) return;
    const run = this.#runs.get(message.id);
    if (run === undefined) return;
    if (message.op === "started") {
      run.cancel = this.#timers.set(() => this.#overran(message.id), run.request.budgetMs);
      return;
    }
    this.#answer(message.id, message.answer);
  }

  #answer(id: number, answer: QueryAnswer): void {
    const run = this.#runs.get(id);
    if (run === undefined) return;
    this.#runs.delete(id);
    run.cancel?.();
    run.settle(answer);
  }

  /** A run overran its budget: it answers so, and the engine is started again for the rest. */
  #overran(id: number): void {
    const run = this.#runs.get(id);
    if (run === undefined) return;
    this.#answer(id, {
      kind: "over-budget",
      budgetMs: run.request.budgetMs,
      generation: run.generation,
    });
    this.#restart();
  }

  /** The engine failed outside a run: every run out answers so, and a fresh engine takes over. */
  #failed(port: EnginePort): void {
    if (port !== this.#port) return;
    for (const [id, run] of this.#runs) this.#answer(id, this.#stopped(run, "failed"));
    this.#restart();
  }

  #stopped(run: Run, how: "closed" | "failed"): QueryAnswer {
    return {
      kind: "error",
      name: "QueryEngineStopped",
      message: how === "closed" ? "the query engine was closed" : "the query engine failed",
      generation: run.generation,
    };
  }

  #restart(): void {
    if (this.#closed) return;
    this.#port.terminate();
    this.restarts += 1;
    this.#port = this.#start();
    for (const [id, run] of this.#runs) {
      run.cancel?.();
      run.cancel = null;
      this.#port.send({ op: "query", id, request: run.request });
    }
  }
}

/**
 * The engine in this thread, behind the same port: each message handed to
 * {@link serveIndex} after the sender's turn (`defer`), as a worker would
 * take it. Nothing
 * can stop a run here, so a run that overruns answers so when it ends
 * (`answerOf`); it is the port of a host with no workers (a test's page).
 */
/** What the engine says before anyone listens: nobody hears it. */
function unheard(): void {}

export function inThreadPort(
  derived: readonly DerivedRef[],
  now: () => number,
  defer: (run: () => void) => void,
): EnginePort {
  let stopped = false;
  let hear: (message: FromEngine) => void = unheard;
  const serve = serveIndex(
    derived,
    (message) => {
      defer(() => {
        if (!stopped) hear(message);
      });
    },
    now,
  );
  return {
    send: (message) => {
      defer(() => {
        if (!stopped) serve(message);
      });
    },
    listen: (heard) => {
      hear = heard;
    },
    terminate: () => {
      stopped = true;
    },
  };
}
