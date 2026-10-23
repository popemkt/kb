// oxlint-disable-next-line typescript/triple-slash-reference -- datascript ships no types; the shim travels with the modules that import it (see ../datascript.d.ts)
/// <reference path="../datascript.d.ts" />
import * as d from "datascript";
import { present, type KbNode, type NodeId, type StoreTx } from "@kb/model";
import {
  datascriptExecutor,
  pull as dsPull,
  answerQuery,
  runIr,
  type ClockSampler,
} from "../datascript.ts";
import type { Ir } from "../ir/ir.ts";
import { parseEdn } from "../ir/parse.ts";
import { type Datom, type DatascriptDb, type IdMap, nodeToDatoms, schemaFor } from "./datoms.ts";
import type { DerivedRef } from "./derived.ts";
import type { DatalogAnswer, KbIndex } from "./index.ts";
import { NodeTable } from "./node-table.ts";
import { readSetOf, touches, type ChangedDatom, type ReadSet } from "./read-set.ts";

/** Identity of a datom within one entity — attr plus value, compared structurally. */
function datomKey(attr: string, value: unknown): string {
  return `${attr} ${JSON.stringify(value)}`;
}

function normalizeRows(raw: unknown): Array<Array<unknown>> {
  if (raw === undefined || raw === null) return [];
  const list = raw instanceof Set ? [...raw] : Array.isArray(raw) ? raw : [];
  return list.map((row) => (Array.isArray(row) ? row : [row]));
}

/** How many answers an index remembers, least recently asked forgotten first. */
const KEPT_ANSWERS = 256;

/** An answer with more rows than this is not remembered: the bound on what one remembered answer holds. */
const KEPT_ROWS = 50_000;

/** One operation of a transaction the index hands DataScript. */
type TxOp =
  | readonly [":db/add" | ":db/retract", number, string, unknown]
  | readonly [":db/retractEntity", number];

/** An answer the index remembers: its rows, until when they hold, and what the run that made them read. */
interface Kept extends DatalogAnswer {
  readonly reads: ReadSet;
}

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

/**
 * The one {@link KbIndex} implementation: an in-memory DataScript db kept
 * incrementally in step with the store.
 *
 * Eids are stable and monotonic — allocated on a node's first appearance and
 * never reused, so a revived eid always means the node it meant before. The
 * schema is derived from the data (a `:f/<field>` attr is a ref attr because
 * some node put a ref in it), which is the one thing `d.db_with` cannot grow:
 * a transaction that introduces a new attr falls back to a full rebuild and
 * is counted in {@link rebuilds}. One that turns a known attr into a ref attr
 * changes how a run revives that attr's values, not the db, so it forgets
 * every remembered answer instead.
 */
export class DatascriptIndex implements KbIndex {
  readonly #table: NodeTable;
  #db: unknown;
  #rebuilds = 0;
  #ids: IdMap = { toEid: new Map(), toId: new Map() };
  #nextEid = 1;
  #attrs = new Set<string>();
  /** Field attrs that have held a node ref since the last rebuild (`DatascriptDb.refAttrs`). */
  #refAttrs = new Set<string>();
  /** The derived ref attributes this index builds (`DerivedRef`). */
  readonly #derived: readonly DerivedRef[];
  readonly #clock: ClockSampler | undefined;
  /** Answers by query text, least recently asked first; each held until a transaction touches its read set. */
  readonly #answers = new Map<string, Kept>();
  #runs = 0;

  /**
   * An index over `nodes`, deriving the ref attributes `derived` names. A
   * host builds its index with what its families declare (`bundledDerived`
   * in `@kb/bundled`).
   */
  constructor(nodes: ReadonlyArray<KbNode>, options: IndexOptions) {
    this.#derived = options.derived;
    this.#clock = options.clock;
    this.#table = new NodeTable(nodes, options.derived);
    this.#buildDatoms();
  }

  get generation(): number {
    return this.#table.generation;
  }

  /** Full index builds since construction — the number Phase 4 gates on. */
  get rebuilds(): number {
    return this.#rebuilds;
  }

  /**
   * Query runs since construction: an answer it remembered and gave again
   * is not one. What the read-set benchmark counts.
   */
  get runs(): number {
    return this.#runs;
  }

  #datascriptDb(): DatascriptDb {
    return { db: this.#db, ids: this.#ids, refAttrs: this.#refAttrs };
  }

  rebuild(nodes: ReadonlyArray<KbNode>): void {
    this.#table.rebuild(nodes);
    this.#buildDatoms();
  }

  /** Every datom from the table's nodes, at once: the build `d.db_with` cannot grow into. */
  #buildDatoms(): void {
    const merged = [...this.#table.allNodes()];
    this.#syncIds(merged);
    this.#attrs = new Set();
    this.#refAttrs = new Set();
    const datoms: Datom[] = [];
    for (const node of merged) {
      const built = nodeToDatoms(node, this.#ids, this.#derived);
      datoms.push(...built.datoms);
      for (const attr of built.attrs) this.#attrs.add(attr);
      for (const attr of built.refAttrs) this.#refAttrs.add(attr);
    }
    this.#db = d.init_db(datoms, schemaFor(this.#attrs, this.#derived));
    this.#rebuilds += 1;
    // A rebuild says nothing about which datoms moved: every answer is asked again.
    this.#answers.clear();
  }

  applyTx(tx: StoreTx): void {
    // Retractions name the eids as they stand, so they are collected before the
    // id map moves under them.
    const retracts: TxOp[] = tx.deletes
      .filter((id) => this.#table.getNode(id) !== undefined)
      .map((id) => [":db/retractEntity", present(this.#ids.toEid.get(id), `eid for ${id}`)]);
    const change = this.#table.change(tx);
    if (change === null) return;
    for (const id of change.created) this.#allocate(id);
    for (const id of change.removed) this.#forget(id);

    const adds: TxOp[] = [];
    let grown = false;
    let revived = false;
    for (const node of change.restated) {
      const built = nodeToDatoms(node, this.#ids, this.#derived);
      for (const attr of built.attrs) {
        if (!this.#attrs.has(attr)) grown = true;
      }
      for (const attr of built.refAttrs) {
        if (!this.#refAttrs.has(attr)) revived = true;
        this.#refAttrs.add(attr);
      }
      const eid = present(this.#ids.toEid.get(node.id), `eid for ${node.id}`);
      this.#diffEntity(eid, built.datoms, retracts, adds);
    }

    if (grown) {
      // The schema is fixed at `init_db`: a first-seen attr needs its
      // cardinality declared, and only a rebuild can declare it.
      this.#buildDatoms();
      return;
    }
    const changed = this.#changedBy(retracts, adds);
    this.#db = d.db_with(this.#db, [...retracts, ...adds]);
    // A run revives a ref attr's values as nodes wherever they sit
    // (`findWithRefAttrs`), so a new one can change any answer that reads it.
    if (revived) this.#answers.clear();
    for (const [edn, kept] of this.#answers) {
      if (touches(kept.reads, changed)) this.#answers.delete(edn);
    }
  }

  /**
   * The datoms `retracts` and `adds` move, by attribute: an entity retracted
   * whole is every datom it has. What a remembered answer's read set is
   * matched against.
   */
  #changedBy(retracts: readonly TxOp[], adds: readonly TxOp[]): Map<string, ChangedDatom[]> {
    const changed = new Map<string, ChangedDatom[]>();
    const add = (datom: ChangedDatom): void => {
      const list = changed.get(datom.a);
      if (list === undefined) changed.set(datom.a, [datom]);
      else list.push(datom);
    };
    for (const op of [...retracts, ...adds]) {
      if (op[0] === ":db/retractEntity") {
        for (const datom of d.datoms(this.#db, ":eavt", op[1])) add(datom);
      } else {
        add({ e: op[1], a: op[2], v: op[3] });
      }
    }
    return changed;
  }

  runDatalog(edn: string, ...inputs: ReadonlyArray<unknown>): Array<Array<unknown>> {
    return this.answerDatalog(edn, ...inputs).rows;
  }

  /**
   * The answer to `edn`, run again only when a transaction since the last
   * run touched what that run read (`readSetOf`), or a clocked answer's time
   * is up. A query with inputs is run every time: its answer depends on
   * them. The rows of a remembered answer are the same arrays each time it
   * is given, and no caller may change them.
   */
  answerDatalog(edn: string, ...inputs: ReadonlyArray<unknown>): DatalogAnswer {
    if (inputs.length > 0) return this.#answer(parseEdn(edn), inputs);
    const kept = this.#answers.get(edn);
    if (kept !== undefined && this.#holds(kept)) {
      this.#answers.delete(edn);
      this.#answers.set(edn, kept);
      return { rows: kept.rows, holdsUntilMs: kept.holdsUntilMs };
    }
    const ir = parseEdn(edn);
    const answer = this.#answer(ir, inputs);
    this.#answers.delete(edn);
    if (answer.rows.length <= KEPT_ROWS) {
      this.#answers.set(edn, { ...answer, reads: readSetOf(ir, this.#datascriptDb()) });
      for (const oldest of this.#answers.keys()) {
        if (this.#answers.size <= KEPT_ANSWERS) break;
        this.#answers.delete(oldest);
      }
    }
    return answer;
  }

  /** Whether a remembered answer still holds now: one that read the clock holds until its time. */
  #holds(kept: Kept): boolean {
    if (kept.holdsUntilMs === null) return true;
    return this.#clock !== undefined && this.#clock().nowMs < kept.holdsUntilMs;
  }

  #answer(ir: Ir, inputs: ReadonlyArray<unknown>): DatalogAnswer {
    this.#runs += 1;
    const { value, holdsUntilMs } = answerQuery(this.#datascriptDb(), ir, inputs, this.#clock);
    return { rows: normalizeRows(value), holdsUntilMs };
  }

  run(ir: Ir, ...inputs: ReadonlyArray<unknown>): Array<Array<unknown>> {
    return normalizeRows(
      runIr(datascriptExecutor(this.#datascriptDb()), ir, this.#ids, inputs, this.#clock),
    );
  }

  pull(pattern: string, id: NodeId): unknown {
    return dsPull(this.#datascriptDb(), pattern, id);
  }

  referencesOf(node: KbNode): ReadonlySet<NodeId> {
    return this.#table.referencesOf(node);
  }

  getNode(id: NodeId): KbNode | undefined {
    return this.#table.getNode(id);
  }

  allNodes(): Iterable<KbNode> {
    return this.#table.allNodes();
  }

  storedNodes(): Array<KbNode> {
    return this.#table.storedNodes();
  }

  search(text: string, limit?: number): Array<KbNode> {
    return this.#table.search(text, limit);
  }

  withVirtual(nodes: ReadonlyArray<KbNode>): void {
    this.#table.withVirtual(nodes);
    this.#buildDatoms();
  }

  /** Retract what this entity has and add what it should have — the difference only. */
  #diffEntity(eid: number, next: Datom[], retracts: TxOp[], adds: TxOp[]): void {
    const before = new Map<string, { a: string; v: unknown }>();
    for (const datom of d.datoms(this.#db, ":eavt", eid)) {
      before.set(datomKey(datom.a, datom.v), datom);
    }
    const after = new Set<string>();
    for (const [, attr, value] of next) {
      const key = datomKey(attr, value);
      after.add(key);
      if (!before.has(key)) adds.push([":db/add", eid, attr, value]);
    }
    for (const [key, datom] of before) {
      if (!after.has(key)) retracts.push([":db/retract", eid, datom.a, datom.v]);
    }
  }

  #allocate(id: NodeId): void {
    if (this.#ids.toEid.has(id)) return;
    this.#ids.toEid.set(id, this.#nextEid);
    this.#ids.toId.set(this.#nextEid, id);
    this.#nextEid += 1;
  }

  /** Drop the mapping; the number itself is retired, never handed out again. */
  #forget(id: NodeId): void {
    const eid = this.#ids.toEid.get(id);
    if (eid === undefined) return;
    this.#ids.toEid.delete(id);
    this.#ids.toId.delete(eid);
  }

  #syncIds(nodes: ReadonlyArray<KbNode>): void {
    const live = new Set(nodes.map((n) => n.id));
    // Deleting the entry the Map iterator is on is well defined, so the live
    // ids are filtered in one pass rather than over a copy.
    for (const [id, eid] of this.#ids.toEid) {
      if (live.has(id)) continue;
      this.#ids.toEid.delete(id);
      this.#ids.toId.delete(eid);
    }
    for (const node of nodes) this.#allocate(node.id);
  }
}
