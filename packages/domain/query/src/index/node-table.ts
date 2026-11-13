import { tagAncestors, type FieldType, type KbNode, type NodeId, type StoreTx } from "@kb/model";
import { derivedTargets, nodeRefs, referenceFields } from "./datoms.ts";
import {
  fieldTypesIn,
  keyHolders,
  keysOf,
  type DerivedRef,
  type FieldTypes,
  type GraphReads,
  type KeyRef,
} from "./derived.ts";
import type { NodeIndex } from "./index.ts";
import { ReadMemo } from "./read-memo.ts";

/** A key as one string, for the maps keyed by key. */
function keyName(key: KeyRef): string {
  return JSON.stringify([key.field, key.value]);
}

function byId(a: KbNode, b: KbNode): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * What one transaction changed in the table, for a query engine kept over
 * it: the ids that appeared and vanished, and every node whose derived
 * facts must be restated — the upserts, each referrer of an id that
 * appeared or vanished, since a node's facts depend on whether its targets
 * exist, and each referrer of a field whose type changed, since a carrier
 * reads a value with its field's type (`FieldTypes`). A type changes when
 * anything its reading looked up does: the field's choice of option, or
 * the option node it chooses appearing, vanishing or naming another type.
 * And each referrer of a tag whose chain changed (`GraphReads.ancestors`),
 * since a node is each tag on its tags' chains: a tag on it changed what it
 * extends, appeared or vanished. And each node that asked who holds a key
 * (`GraphReads.holders`) whose holders changed: a node took the key, gave it
 * up, or was deleted.
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
  /**
   * Whether the two maps above are yet to be read from the nodes. Only a
   * change reads them (its referrers), so a table that is built and only
   * read never reads every node's references.
   */
  #refsStale = true;
  #storedCache: { generation: number; nodes: KbNode[] } | null = null;
  #derived: readonly DerivedRef[];

  constructor(nodes: ReadonlyArray<KbNode>, derived: readonly DerivedRef[]) {
    this.#derived = derived;
    this.rebuild(nodes);
  }

  get generation(): number {
    return this.#generation;
  }

  /**
   * Each field's declared type, as read (`fieldTypesIn`), with every id
   * the reading looked up: the field itself and the type option it
   * chooses, which may be a person's own node naming a built-in type.
   */
  #types = new ReadMemo<FieldType>(
    (field, nodeOf) => fieldTypesIn(nodeOf)(field),
    (id) => this.#nodes.get(id),
  );

  /**
   * Each field's declared type in the table as it stands, read as every
   * surface reads it (`fieldTypeOf`): what carriers are handed. Remembered
   * with what it read, so a change to any of it, however many hops from
   * the field, reads it again (`change`).
   */
  readonly fieldTypes: FieldTypes = (field) => this.#types.get(field);

  /**
   * Each tag's chain (`tagAncestors`), with every tag the walk looked up:
   * a change to any tag's `extends` on it reads it again, and the nodes
   * pointing at the tag — those of it, and those of a tag that extends it,
   * whose `:node/is` holds it — are restated (`change`).
   */
  #chains = new ReadMemo<readonly NodeId[]>(
    (tag, nodeOf) => tagAncestors(tag, nodeOf),
    (id) => this.#nodes.get(id),
    (a, b) => a.length === b.length && a.every((id, i) => id === b[i]),
  );

  /** Who holds each value of each key field asked about: field → value → holders. */
  #holders = new Map<NodeId, Map<string, Set<NodeId>>>();
  /** A key, as one string (`keyName`) → the nodes whose carriers asked who holds it. */
  #keyReaders = new Map<string, Set<NodeId>>();
  /** node → the keys its carriers asked about (the reverse of `#keyReaders`). */
  #keysReadBy = new Map<NodeId, Set<string>>();

  /**
   * What carriers read of the table beyond the node (`GraphReads`), on
   * behalf of `reader`: each key it asks about is remembered against it,
   * so a change of that key's holders reads it again (`change`). A node
   * only planned, or a question with no node behind it, is asked with no
   * reader and leaves nothing behind.
   */
  readsOf(reader: NodeId | null): GraphReads {
    return {
      fieldType: this.fieldTypes,
      ancestors: (tag) => this.#chains.get(tag),
      holders: (key) => {
        if (reader !== null) this.#rememberKeyRead(reader, key);
        return [...(this.#holdersOf(key.field).get(key.value) ?? [])];
      },
    };
  }

  /** The full index replaces its definition while keeping this node table. */
  setDerived(derived: readonly DerivedRef[]): void {
    this.#derived = derived;
    this.rebuild(this.storedNodes());
  }

  rebuild(nodes: ReadonlyArray<KbNode>): void {
    const stored = new Set(nodes.map((n) => n.id));
    this.#virtual = this.#virtual.filter((n) => !stored.has(n.id));
    this.#virtualIds = new Set(this.#virtual.map((n) => n.id));
    const merged = [...nodes, ...this.#virtual];
    this.#nodes = new Map(merged.map((n) => [n.id, n]));
    this.#refsFrom = new Map();
    this.#refsTo = new Map();
    this.#types.clear();
    this.#chains.clear();
    this.#holders = new Map();
    this.#keyReaders = new Map();
    this.#keysReadBy = new Map();
    this.#refsStale = true;
    this.#generation += 1;
  }

  /** Read every node's references, once after a rebuild, before a change needs its referrers. */
  #readRefs(): void {
    if (!this.#refsStale) return;
    this.#refsStale = false;
    for (const node of this.#nodes.values())
      this.#setRefs(node.id, nodeRefs(node, this.#derived, this.readsOf(node.id)));
  }

  applyTx(tx: StoreTx): void {
    this.change(tx);
  }

  /**
   * Apply `tx` and say what it changed ({@link NodeChange}); null, and no new
   * generation, when it changes nothing.
   */
  change(tx: StoreTx): NodeChange | null {
    this.#readRefs();
    const created = tx.upserts.filter((n) => !this.#nodes.has(n.id)).map((n) => n.id);
    const removed = tx.deletes.filter((id) => this.#nodes.has(id));
    if (created.length === 0 && removed.length === 0 && tx.upserts.length === 0) return null;
    const touched = [...tx.upserts.map((n) => n.id), ...tx.deletes];
    const typed = this.#types.forget(touched);
    const chained = this.#chains.forget(touched);
    const keysWere = new Map(touched.map((id) => [id, this.#keysHeld(this.#nodes.get(id))]));

    for (const id of removed) {
      this.#setRefs(id, new Set());
      this.#forgetKeyReads(id);
    }
    for (const node of tx.upserts) this.#nodes.set(node.id, node);
    for (const id of removed) this.#nodes.delete(id);
    const rekeyed = this.#moveKeys(keysWere);
    // A virtual node a tx stores or deletes is no longer virtual: nothing brings it back.
    this.#dropVirtual([...tx.upserts.map((n) => n.id), ...removed]);

    const restated = new Map<NodeId, KbNode>();
    for (const node of tx.upserts) restated.set(node.id, node);
    const retyped = this.#types.changed(typed);
    const rechained = this.#chains.changed(chained);
    const referrers = [...created, ...removed, ...retyped, ...rechained].flatMap((id) => [
      ...(this.#refsTo.get(id) ?? []),
    ]);
    for (const referrer of [...referrers, ...rekeyed]) {
      const node = this.#nodes.get(referrer);
      if (node !== undefined) restated.set(referrer, node);
    }
    for (const node of restated.values()) this.#restate(node);
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
    return nodeRefs(node, this.#derived, this.readsOf(null));
  }

  related(id: NodeId, attr: DerivedRef["attr"]): readonly NodeId[] {
    const node = this.#nodes.get(id);
    const entry = this.#derived.find((each) => each.attr === attr);
    if (node === undefined || entry === undefined) return [];
    const targets = new Set(
      derivedTargets(node, entry, this.readsOf(null)).map((carried) => carried.id),
    );
    return [...targets].filter((target) => this.#nodes.has(target));
  }

  referenceFields(node: KbNode, target: NodeId): ReadonlySet<NodeId> {
    return referenceFields(node, target, this.#derived, this.readsOf(null));
  }

  getNode(id: NodeId): KbNode | undefined {
    return this.#nodes.get(id);
  }

  allNodes(): Iterable<KbNode> {
    return this.#nodes.values();
  }

  isVirtual(id: NodeId): boolean {
    return this.#virtualIds.has(id);
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

  /** Read `node`'s references again, its key reads with them. */
  #restate(node: KbNode): void {
    this.#forgetKeyReads(node.id);
    this.#setRefs(node.id, nodeRefs(node, this.#derived, this.readsOf(node.id)));
  }

  /** Who holds each value of `field`, indexed the first time a carrier asks. */
  #holdersOf(field: NodeId): Map<string, Set<NodeId>> {
    let values = this.#holders.get(field);
    if (values === undefined) {
      values = new Map(
        [...keyHolders(this.#nodes.values(), field)].map(([value, ids]) => [value, new Set(ids)]),
      );
      this.#holders.set(field, values);
    }
    return values;
  }

  #rememberKeyRead(reader: NodeId, key: KeyRef): void {
    const name = keyName(key);
    const readers = this.#keyReaders.get(name);
    if (readers === undefined) this.#keyReaders.set(name, new Set([reader]));
    else readers.add(reader);
    const read = this.#keysReadBy.get(reader);
    if (read === undefined) this.#keysReadBy.set(reader, new Set([name]));
    else read.add(name);
  }

  #forgetKeyReads(reader: NodeId): void {
    for (const name of this.#keysReadBy.get(reader) ?? [])
      this.#keyReaders.get(name)?.delete(reader);
    this.#keysReadBy.delete(reader);
  }

  /** The keys `node` holds in the key fields indexed so far, by `keyName`. */
  #keysHeld(node: KbNode | undefined): Map<string, KeyRef> {
    const held = new Map<string, KeyRef>();
    for (const field of this.#holders.keys())
      for (const value of keysOf(node, field))
        held.set(keyName({ field, value }), { field, value });
    return held;
  }

  /**
   * Bring the key index up to the nodes as they now stand, given the keys
   * each touched node held before (`was`), and say who asked about a key
   * whose holders changed.
   */
  #moveKeys(was: ReadonlyMap<NodeId, ReadonlyMap<string, KeyRef>>): Set<NodeId> {
    const readers = new Set<NodeId>();
    for (const [id, before] of was) {
      const after = this.#keysHeld(this.#nodes.get(id));
      for (const [name, key] of before) {
        if (after.has(name)) continue;
        this.#holders.get(key.field)?.get(key.value)?.delete(id);
        for (const reader of this.#keyReaders.get(name) ?? []) readers.add(reader);
      }
      for (const [name, key] of after) {
        if (before.has(name)) continue;
        const values = this.#holdersOf(key.field);
        const holders = values.get(key.value);
        if (holders === undefined) values.set(key.value, new Set([id]));
        else holders.add(id);
        for (const reader of this.#keyReaders.get(name) ?? []) readers.add(reader);
      }
    }
    return readers;
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
