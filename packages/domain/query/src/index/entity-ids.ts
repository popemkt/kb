import type { KbNode, NodeId } from "@kb/model";
import type { IdMap } from "./datoms.ts";

/** The stable ids DataScript uses for this index's node ids. */
export class EntityIds implements IdMap {
  readonly toEid = new Map<NodeId, number>();
  readonly toId = new Map<number, NodeId>();
  #next = 1;

  allocate(id: NodeId): void {
    if (this.toEid.has(id)) return;
    this.toEid.set(id, this.#next);
    this.toId.set(this.#next, id);
    this.#next += 1;
  }

  forget(id: NodeId): void {
    const eid = this.toEid.get(id);
    if (eid === undefined) return;
    this.toEid.delete(id);
    this.toId.delete(eid);
  }

  sync(nodes: readonly KbNode[]): void {
    const live = new Set(nodes.map((node) => node.id));
    for (const id of this.toEid.keys()) if (!live.has(id)) this.forget(id);
    for (const node of nodes) this.allocate(node.id);
  }
}
