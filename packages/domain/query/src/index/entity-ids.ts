import type { KbNode, NodeId } from "@kb/model";
import type { IdMap } from "./datoms.ts";

/** DataScript represents entity ids as positive signed 32-bit integers. */
export function isEidNumber(value: number): boolean {
  return value > 0 && value <= 2_147_483_647 && Number.isInteger(value);
}

/**
 * DataScript uses integers for entities. A stored numeric value and an
 * allocated eid must occupy different integers even in the same field.
 */
export class EntityIds implements IdMap {
  readonly toEid = new Map<NodeId, number>();
  readonly toId = new Map<number, NodeId>();
  readonly #scalars = new Map<number, number>();
  #next = 1;

  allocate(id: NodeId): void {
    if (this.toEid.has(id)) return;
    while (this.#scalars.has(this.#next)) this.#next += 1;
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

  /** Rebuild numeric reservations and keep every surviving noncolliding id. */
  sync(nodes: readonly KbNode[]): void {
    this.#scalars.clear();
    this.note([], nodes);
    const live = new Set(nodes.map(({ id }) => id));
    for (const [id, eid] of this.toEid) {
      if (!live.has(id) || this.#scalars.has(eid)) this.forget(id);
    }
    for (const { id } of nodes) this.allocate(id);
  }

  /** Refresh the reservations for changed nodes. True when an eid must move. */
  note(before: readonly KbNode[], after: readonly KbNode[]): boolean {
    for (const node of before) this.#count(node, -1);
    let collision = false;
    for (const node of after) if (this.#count(node, 1)) collision = true;
    return collision;
  }

  #count(node: KbNode, delta: 1 | -1): boolean {
    let collision = false;
    for (const values of Object.values(node.props)) {
      for (const value of values) {
        if (value.t !== "num" || !isEidNumber(value.v)) continue;
        const count = (this.#scalars.get(value.v) ?? 0) + delta;
        if (count <= 0) this.#scalars.delete(value.v);
        else this.#scalars.set(value.v, count);
        if (delta === 1 && this.toId.has(value.v)) collision = true;
      }
    }
    return collision;
  }
}
