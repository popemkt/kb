import { Context } from "effect";
import type { KbNode, NodeId, StoreTx } from "@kb/model";
import type { DerivedRef } from "./derived.ts";
import type { ClockSampler } from "../datascript.ts";
import type { Ir } from "../ir/ir.ts";

/** How an index is built beyond its nodes. */
export interface IndexOptions {
  /**
   * The derived ref attributes it builds: what the host's families declare
   * (`bundledDerived`, `derivedOf`), or the core table alone
   * (`derivedWith({})`). Required, so no host drops a family's references by
   * leaving it out.
   */
  readonly derived: readonly DerivedRef[];
  /**
   * Where a run's clock sample comes from: the `Clock` and zone of the host
   * that builds the index (`clockSampler` in `@kb/model`), sampled once by a
   * run that calls a clocked kb function (`kb/today`, …) and never by any
   * other run, and by a remembered clocked answer to learn whether it still
   * holds. Without one, such a query fails naming the function; the index
   * never falls back to a wall clock of its own.
   */
  readonly clock?: ClockSampler;
}

/** A datalog query's rows, and until when (epoch ms) they hold; null until the graph moves. */
export interface DatalogAnswer {
  readonly rows: Array<Array<unknown>>;
  readonly holdsUntilMs: number | null;
}

/**
 * The node set an index answers over, and its point reads: the half of an
 * index that is a lookup, not a query engine. A host whose query engine runs
 * somewhere else (the page's, in a worker) keeps this half where its writes
 * run, so a write reads the nodes it touches synchronously; every
 * {@link KbIndex} is one too.
 */
export interface NodeIndex {
  /** Bumps on every `rebuild` / `applyTx` / `withVirtual` that changes something. */
  readonly generation: number;

  /** Replace the stored node set. The virtual set (see `withVirtual`) survives. */
  rebuild(nodes: ReadonlyArray<KbNode>): void;

  /**
   * Apply one committed transaction. Implementations should do this
   * incrementally and may fall back to a full `rebuild` whenever the tx is
   * outside what their incremental path covers.
   */
  applyTx(tx: StoreTx): void;

  getNode(id: NodeId): KbNode | undefined;

  /**
   * The ids `node` points at, read as the index reads references: its
   * children, its ref values and every carrier of its derived relations
   * (`DerivedRef`), resolvable or not. Asked of any node, stored or only planned, so a
   * write can be read for what it would point at before it lands.
   */
  referencesOf(node: KbNode): ReadonlySet<NodeId>;

  /**
   * The nodes `id` points at by the derived attribute `attr` (`DerivedRef`),
   * as its datoms state them: each target of the attribute's carriers that
   * the index holds, once, in the order the carriers read them. None for a
   * node the index does not hold or an attribute it does not derive. A
   * cardinality-one attribute answers at most one: `:node/owner`, who seeds
   * the node.
   */
  related(id: NodeId, attr: DerivedRef["attr"]): readonly NodeId[];

  /** Every node the index answers over — stored plus virtual. */
  allNodes(): Iterable<KbNode>;

  /**
   * The stored projection: everything except the virtual set. This is what
   * persist, transaction integrity and the hub's broadcast diff baseline operate on, and the
   * reason the rule "a virtual node must never reach the store" is enforced
   * by the index rather than remembered at three call sites.
   */
  storedNodes(): Array<KbNode>;

  /**
   * Whether `id` is one of the index's virtual nodes: served from a source
   * that is not the store (a saved query's `.edn`), which a stored node of
   * the same id would shadow. The commit refuses a person's write to one
   * for that reason.
   */
  isVirtual(id: NodeId): boolean;

  /** Case-insensitive substring scan over node text, sorted by id. */
  search(text: string, limit?: number): Array<KbNode>;

  /**
   * Index-only nodes: they answer queries and never reach the store. Saved
   * queries are materialised this way by `kb ui`. Replaces the set wholesale;
   * a stored node of the same id always wins.
   */
  withVirtual(nodes: ReadonlyArray<KbNode>): void;
}

/**
 * The one owner of "the current graph as something you can ask questions of".
 *
 * A kb session has exactly two collaborators: {@link KbStore}, which owns the
 * committed truth (`.kb/nodes.jsonl`), and this, which owns everything derived
 * from it — the datoms, the id map, the node lookup, the text scan. Nothing
 * outside an implementation of this port may hold a query engine handle, and
 * nothing beside it may hold a second copy of the node set: a service standing
 * next to a `qdb` field is the parallel path Rule 1 forbids.
 *
 * The index is derived and rebuildable. `rebuild` is always correct, so any
 * incremental path an implementation takes is an optimisation it may abandon
 * (see {@link NodeIndex.applyTx}), never a source of truth.
 *
 * Reads are synchronous. Every caller today is inside an `Effect.try` that
 * assumes a synchronous throw; an implementation whose point reads are async
 * (a SQLite index) would change three surfaces. Recorded as a `#gap`, not
 * papered over here.
 */
export interface KbIndex extends NodeIndex {
  /**
   * Replace the full query index's derived-reference definition. Rebuild
   * its facts and point reads over the same stored and virtual nodes,
   * preserving ids, advancing generation and forgetting cached answers.
   */
  setDerived(derived: readonly DerivedRef[]): void;

  /**
   * Raw datalog in the engine's own dialect, as rows. Engine-specific by
   * construction: this is the surface `graph.query` / `kb query` / the WS
   * `subscribe` frame expose to users, EDN and all.
   */
  runDatalog(edn: string, ...inputs: ReadonlyArray<unknown>): Array<Array<unknown>>;

  /**
   * {@link runDatalog}'s rows, and until when they hold: a query that read
   * the clock (`kb/today`, …) answers for a while only (`holdsUntil`), one
   * that did not until the graph moves (null).
   */
  answerDatalog(edn: string, ...inputs: ReadonlyArray<unknown>): DatalogAnswer;

  /**
   * Engine-neutral query IR. Unlike the raw EDN surface, result positions are
   * typed, so aggregate numbers are never mistaken for engine entity ids.
   */
  run(ir: Ir, ...inputs: ReadonlyArray<unknown>): Array<Array<unknown>>;

  /** Engine pull for one node. Engine-specific for the same reason. */
  pull(pattern: string, id: NodeId): unknown;
}

export class KbIndexService extends Context.Service<KbIndexService, KbIndex>()("kb/KbIndex") {}
