import type { KbNode, NodeId } from "./model.ts";
import { compareRootOrder, type RankBase, type Slots } from "./order.ts";
import type { StoreTx } from "./tx.ts";

/**
 * The node set a store holds, as the store keeps it between commits: each
 * node by id, each node's parent, and the forest roots, moved by applying
 * the transactions the store commits (`apply`, deletes first and then
 * upserts, as `applyTx` does).
 *
 * A store keeps one under the fingerprint of the state it holds, so a commit
 * that lands on that state settles its ranks (`rankTx` reads it as a
 * {@link RankBase}) without reading the store again; a commit that finds
 * another fingerprint reads the store and starts a new one. It is never the
 * truth: dropping it costs one read.
 *
 * Nodes are held as given, not copied: a node is a value, replaced whole by
 * an upsert, and nothing writes into one.
 */
export class StoreState implements RankBase {
  readonly #nodes = new Map<NodeId, KbNode>();
  readonly #parentOf = new Map<NodeId, NodeId>();
  readonly #roots = new Set<NodeId>();
  /** The roots in visible order, once asked for; dropped by any write that could move them. */
  #ordered: KbNode[] | null = null;

  static of(nodes: Iterable<KbNode>): StoreState {
    const state = new StoreState();
    state.apply({ upserts: [...nodes], deletes: [] });
    return state;
  }

  get size(): number {
    return this.#nodes.size;
  }

  get(id: NodeId): KbNode | undefined {
    return this.#nodes.get(id);
  }

  parentOf(id: NodeId): NodeId | undefined {
    return this.#parentOf.get(id);
  }

  roots(): Slots<KbNode> {
    this.#ordered ??= [...this.#roots]
      .flatMap((id) => this.#nodes.get(id) ?? [])
      .toSorted(compareRootOrder);
    const roots = this.#ordered;
    return { length: roots.length, at: (i) => roots[i] };
  }

  values(): IterableIterator<KbNode> {
    return this.#nodes.values();
  }

  apply(tx: StoreTx): void {
    this.#ordered = null;
    for (const id of tx.deletes) this.#delete(id);
    for (const node of tx.upserts) this.#put(node);
  }

  #put(node: KbNode): void {
    const old = this.#nodes.get(node.id);
    this.#nodes.set(node.id, node);
    if (old !== undefined) {
      const kept = new Set(node.children);
      for (const child of old.children) {
        if (!kept.has(child) && this.#parentOf.get(child) === node.id) this.#unparent(child);
      }
    }
    for (const child of node.children) {
      this.#parentOf.set(child, node.id);
      this.#roots.delete(child);
    }
    if (!this.#parentOf.has(node.id)) this.#roots.add(node.id);
  }

  #delete(id: NodeId): void {
    const old = this.#nodes.get(id);
    if (old === undefined) return;
    this.#nodes.delete(id);
    this.#roots.delete(id);
    for (const child of old.children) {
      if (this.#parentOf.get(child) === id) this.#unparent(child);
    }
  }

  /** `child` no longer has the parent it had: a root, if it is a node. */
  #unparent(child: NodeId): void {
    this.#parentOf.delete(child);
    if (this.#nodes.has(child)) this.#roots.add(child);
  }
}
