import { nodeTitleOf, type KbNode, type NodeId } from "@kb/model";

function byId(a: KbNode, b: KbNode): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** The literal text and display title search over a node table. */
export class TextSearch {
  readonly #nodes: () => Iterable<KbNode>;
  readonly #nodeOf: (id: NodeId) => KbNode | undefined;

  constructor(nodes: () => Iterable<KbNode>, nodeOf: (id: NodeId) => KbNode | undefined) {
    this.#nodes = nodes;
    this.#nodeOf = nodeOf;
  }

  search(text: string, limit?: number): KbNode[] {
    const needle = text.toLowerCase();
    const hits: KbNode[] = [];
    for (const node of this.#nodes()) {
      if (node.text.toLowerCase().includes(needle)) hits.push(node);
      // GAP [[01M7HCW2CRPCQ04SSRNG2FHSNS]] matched against the source, not the words it reads as
      else if (nodeTitleOf(node.id, node, this.#nodeOf).toLowerCase().includes(needle))
        hits.push(node);
    }
    hits.sort(byId);
    return limit !== undefined && hits.length > limit ? hits.slice(0, limit) : hits;
  }
}
