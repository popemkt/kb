import type { KbNode, NodeId } from "@kb/model";

/** How a memo looks a node up, and how the reading it remembers does too. */
type NodeOf = (id: NodeId) => KbNode | undefined;

/**
 * A value read off the graph per key — a field's declared type, a tag's
 * chain — remembered with every id the reading looked up, found or not, so
 * a change to any of those ids, however many hops from the key, reads it
 * again. The node table keeps one per kind of read it hands carriers
 * (`GraphReads`); a transaction forgets what it touched (`forget`) and asks
 * which of those read differently after (`changed`), whose holders' derived
 * facts are then restated.
 */
export class ReadMemo<V> {
  readonly #read: (key: NodeId, nodeOf: NodeOf) => V;
  readonly #nodeOf: NodeOf;
  readonly #same: (a: V, b: V) => boolean;
  #known = new Map<NodeId, { readonly value: V; readonly reads: ReadonlySet<NodeId> }>();
  /** id → the keys whose reading looked it up (the reverse of each key's reads). */
  #readers = new Map<NodeId, Set<NodeId>>();

  constructor(
    read: (key: NodeId, nodeOf: NodeOf) => V,
    nodeOf: NodeOf,
    same: (a: V, b: V) => boolean = Object.is,
  ) {
    this.#read = read;
    this.#nodeOf = nodeOf;
    this.#same = same;
  }

  /** `key`'s value as the graph stands, read once until something it read changes. */
  get(key: NodeId): V {
    const known = this.#known.get(key);
    if (known !== undefined) return known.value;
    const reads = new Set<NodeId>();
    const value = this.#read(key, (id) => {
      reads.add(id);
      return this.#nodeOf(id);
    });
    this.#known.set(key, { value, reads });
    for (const id of reads) {
      const readers = this.#readers.get(id);
      if (readers === undefined) this.#readers.set(id, new Set([key]));
      else readers.add(key);
    }
    return value;
  }

  /** Forget every key whose reading looked up one of `ids`, and say what each was. */
  forget(ids: Iterable<NodeId>): Map<NodeId, V> {
    const was = new Map<NodeId, V>();
    for (const id of ids) {
      // Deleting the key being visited from the set is safe while iterating it.
      for (const key of this.#readers.get(id) ?? []) {
        const known = this.#known.get(key);
        if (known === undefined) continue;
        was.set(key, known.value);
        this.#known.delete(key);
        for (const read of known.reads) this.#readers.get(read)?.delete(key);
      }
    }
    return was;
  }

  /** Of the keys `forget` answered with, those that read differently now. */
  changed(was: ReadonlyMap<NodeId, V>): NodeId[] {
    return [...was].filter(([key, value]) => !this.#same(this.get(key), value)).map(([key]) => key);
  }

  /** Forget everything: the graph it read was replaced. */
  clear(): void {
    this.#known = new Map();
    this.#readers = new Map();
  }
}
