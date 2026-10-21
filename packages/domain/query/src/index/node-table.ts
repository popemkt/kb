import type { KbNode, NodeId, StoreTx } from "@kb/model";
import { nodeRefs } from "./datoms.ts";
import type { DerivedRef } from "./derived.ts";
import type { NodeIndex } from "./index.ts";

function byId(a: KbNode, b: KbNode): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * What one transaction changed in the table, for a query engine kept over
 * it: the ids that appeared and vanished, and every node whose derived
 * facts must be restated — the upserts, and each referrer of an id that
 * appeared or vanished, since a node's facts depend on whether its targets
 * exist.
 */
export interface NodeChange {
  readonly created: readonly NodeId[];
  readonly removed: readonly NodeId[];
  readonly restated: readonly KbNode[];
}

/**
 * The node set an index answers over, and its point reads: the stored nodes
 * plus the virtual ones, who points at whom, and the text scan. It is the
 * {@link NodeIndex} half of every index, with no query engine: a
 * `DatascriptIndex` keeps its datoms in step with one, and a host whose
 * engine runs elsewhere reads its node set from one here.
 */
export class NodeTable implements NodeIndex {
  #generation = 0;
  /** stored + virtual, in the order `storedNodes` must reproduce */
  #nodes = new Map<NodeId, KbNode>();
  #virtual: KbNode[] = [];
  #virtualIds = new Set<NodeId>();
  /** node → the ids it points at */
  #refsFrom = new Map<NodeId, Set<NodeId>>();
  /** id → the nodes pointing at it, resolvable or not */
  #refsTo = new Map<NodeId, Set<NodeId>>();
  #storedCache: { generation: number; nodes: KbNode[] } | null = null;
  readonly #derived: readonly DerivedRef[];

  constructor(nodes: ReadonlyArray<KbNode>, derived: readonly DerivedRef[]) {
    this.#derived = derived;
    this.rebuild(nodes);
  }

  get generation(): number {
    return this.#generation;
  }

  rebuild(nodes: ReadonlyArray<KbNode>): void {
    const stored = new Set(nodes.map((n) => n.id));
    this.#virtual = this.#virtual.filter((n) => !stored.has(n.id));
    this.#virtualIds = new Set(this.#virtual.map((n) => n.id));
    const merged = [...nodes, ...this.#virtual];
    this.#nodes = new Map(merged.map((n) => [n.id, n]));
    this.#refsFrom = new Map();
    this.#refsTo = new Map();
    for (const node of merged) this.#setRefs(node.id, nodeRefs(node, this.#derived));
    this.#generation += 1;
  }

  applyTx(tx: StoreTx): void {
    this.change(tx);
  }

  /**
   * Apply `tx` and say what it changed ({@link NodeChange}); null, and no new
   * generation, when it changes nothing.
   */
  change(tx: StoreTx): NodeChange | null {
    const created = tx.upserts.filter((n) => !this.#nodes.has(n.id)).map((n) => n.id);
    const removed = tx.deletes.filter((id) => this.#nodes.has(id));
    if (created.length === 0 && removed.length === 0 && tx.upserts.length === 0) return null;

    for (const id of removed) this.#setRefs(id, new Set());
    for (const node of tx.upserts) this.#nodes.set(node.id, node);
    for (const id of removed) this.#nodes.delete(id);
    // A virtual node a tx stores or deletes is no longer virtual: nothing brings it back.
    this.#dropVirtual([...tx.upserts.map((n) => n.id), ...removed]);

    const restated = new Map<NodeId, KbNode>();
    for (const node of tx.upserts) restated.set(node.id, node);
    for (const id of [...created, ...removed]) {
      for (const referrer of this.#refsTo.get(id) ?? []) {
        const node = this.#nodes.get(referrer);
        if (node !== undefined) restated.set(referrer, node);
      }
    }
    for (const node of restated.values()) this.#setRefs(node.id, nodeRefs(node, this.#derived));
    this.#generation += 1;
    return { created, removed, restated: [...restated.values()] };
  }

  withVirtual(nodes: ReadonlyArray<KbNode>): void {
    const stored = this.storedNodes();
    const storedIds = new Set(stored.map((n) => n.id));
    this.#virtual = nodes.filter((n) => !storedIds.has(n.id));
    this.#virtualIds = new Set(this.#virtual.map((n) => n.id));
    this.rebuild(stored);
  }

  referencesOf(node: KbNode): ReadonlySet<NodeId> {
    return nodeRefs(node, this.#derived);
  }

  getNode(id: NodeId): KbNode | undefined {
    return this.#nodes.get(id);
  }

  allNodes(): Iterable<KbNode> {
    return this.#nodes.values();
  }

  /** The virtual nodes still standing: those no stored node has since taken the id of. */
  virtualNodes(): readonly KbNode[] {
    return this.#virtual;
  }

  storedNodes(): Array<KbNode> {
    if (this.#storedCache?.generation === this.#generation) return this.#storedCache.nodes;
    const nodes: KbNode[] = [];
    for (const node of this.#nodes.values()) {
      if (!this.#virtualIds.has(node.id)) nodes.push(node);
    }
    this.#storedCache = { generation: this.#generation, nodes };
    return nodes;
  }

  search(text: string, limit?: number): Array<KbNode> {
    const needle = text.toLowerCase();
    const hits: KbNode[] = [];
    for (const node of this.#nodes.values()) {
      if (node.text.toLowerCase().includes(needle)) hits.push(node);
    }
    hits.sort(byId);
    return limit !== undefined && hits.length > limit ? hits.slice(0, limit) : hits;
  }

  #setRefs(id: NodeId, refs: Set<NodeId>): void {
    for (const target of this.#refsFrom.get(id) ?? []) {
      this.#refsTo.get(target)?.delete(id);
    }
    if (refs.size === 0) this.#refsFrom.delete(id);
    else this.#refsFrom.set(id, refs);
    for (const target of refs) {
      const referrers = this.#refsTo.get(target);
      if (referrers === undefined) this.#refsTo.set(target, new Set([id]));
      else referrers.add(id);
    }
  }

  #dropVirtual(ids: ReadonlyArray<NodeId>): void {
    if (!ids.some((id) => this.#virtualIds.has(id))) return;
    const gone = new Set(ids);
    this.#virtual = this.#virtual.filter((n) => !gone.has(n.id));
    this.#virtualIds = new Set(this.#virtual.map((n) => n.id));
  }
}
