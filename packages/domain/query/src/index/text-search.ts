import { nodeName, type KbNode, type NodeId } from "@kb/model";
import { ReadMemo } from "./read-memo.ts";

/**
 * What search matches a node against: its stored text (`source`, so an id
 * or markup still finds it) and its name, the words it reads as (`title`,
 * `nodeName`: its title, references read as their labels). Lowercased
 * separately so a match cannot cross from one into the other.
 */
export interface SearchDocument {
  readonly source: string;
  readonly title: string;
}

/** A derived candidate index. */
export interface TextCandidates {
  supports(needle: string): boolean;
  reset(documents: Iterable<readonly [NodeId, SearchDocument]>): boolean;
  update(documents: ReadonlyMap<NodeId, SearchDocument | undefined>): boolean;
  /** A bounded candidate set. Undefined means the caller should scan. */
  find(needle: string): readonly NodeId[] | undefined;
}

function byId(a: KbNode, b: KbNode): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** The literal text and display-name search over a node table. */
export class TextSearch {
  readonly #nodes: () => Iterable<KbNode>;
  readonly #nodeOf: (id: NodeId) => KbNode | undefined;

  readonly #candidates: TextCandidates | undefined;
  readonly #documents: ReadMemo<SearchDocument | undefined>;
  #ready = false;

  constructor(
    nodes: () => Iterable<KbNode>,
    nodeOf: (id: NodeId) => KbNode | undefined,
    candidates?: TextCandidates,
  ) {
    this.#nodes = nodes;
    this.#nodeOf = nodeOf;
    this.#candidates = candidates;
    this.#documents = new ReadMemo((id, read) => {
      const node = read(id);
      if (node === undefined) return undefined;
      const source = node.text.toLowerCase();
      const title = nodeName(id, read).toLowerCase();
      return { source, title: title === source ? "" : title };
    }, nodeOf);
  }

  invalidate(): void {
    this.#ready = false;
    this.#documents.clear();
  }

  change(touched: readonly NodeId[]): void {
    if (!this.#ready || this.#candidates === undefined) return;
    const before = this.#documents.forget(touched);
    const changed = new Map<NodeId, SearchDocument | undefined>();
    for (const id of new Set([...before.keys(), ...touched])) {
      const old = before.get(id);
      const next = this.#nodeOf(id) === undefined ? undefined : this.#documents.get(id);
      if (old?.source !== next?.source || old?.title !== next?.title) changed.set(id, next);
    }
    if (!this.#candidates.update(changed)) this.invalidate();
  }

  *#allDocuments(): IterableIterator<readonly [NodeId, SearchDocument]> {
    for (const node of this.#nodes()) {
      const document = this.#documents.get(node.id);
      if (document !== undefined) yield [node.id, document];
    }
  }

  #find(needle: string): readonly NodeId[] | undefined {
    const candidates = this.#candidates;
    if (candidates === undefined || !candidates.supports(needle)) return undefined;
    if (!this.#ready) {
      if (!candidates.reset(this.#allDocuments())) {
        this.invalidate();
        return undefined;
      }
      this.#ready = true;
    }
    return candidates.find(needle);
  }

  #matches(node: KbNode, needle: string, document?: SearchDocument): boolean {
    return (
      (document?.source ?? node.text.toLowerCase()).includes(needle) ||
      (document?.title ?? nodeName(node.id, this.#nodeOf).toLowerCase()).includes(needle)
    );
  }

  search(text: string, limit?: number): KbNode[] {
    const needle = text.toLowerCase();
    if (limit === 0) return [];
    const hits: KbNode[] = [];
    const ids = this.#find(needle);
    if (ids === undefined) {
      for (const node of this.#nodes()) {
        if (this.#matches(node, needle)) hits.push(node);
      }
    } else {
      for (const id of ids) {
        const node = this.#nodeOf(id);
        if (node !== undefined && this.#matches(node, needle, this.#documents.get(id))) {
          hits.push(node);
        }
      }
    }
    hits.sort(byId);
    return limit !== undefined && hits.length > limit ? hits.slice(0, limit) : hits;
  }
}
