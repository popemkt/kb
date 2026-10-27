/**
 * Items changed in place, by id: the refusal every verb that takes items
 * makes (`requireItems`), and the nudge every move by a delta is
 * (`nudgeItems`).
 */
import type { CanvasVec } from "./box.ts";
import type { CanvasDoc } from "./doc.ts";
import { carriedBy, freeItems, settleMembership, transformCarried } from "./membership.ts";
import { CanvasRelationError } from "./relations.ts";
import { moveBy, selectionPivot } from "./transform.ts";

/**
 * Throws unless every one of `ids` is an item of `doc` that an act may take
 * (`freeItems`): the one refusal every verb that moves, lays out or deletes
 * items makes, naming what is missing or locked.
 */
export function requireItems(doc: CanvasDoc, ids: readonly string[]): void {
  const missing = ids.filter((id) => !doc.nodes.some((node) => node.id === id));
  if (missing.length > 0) {
    throw new CanvasRelationError(`no item ${missing.join(", ")} on this canvas`);
  }
  const free = freeItems(doc.nodes, ids);
  const locked = ids.filter((id) => !free.has(id));
  if (locked.length > 0) {
    throw new CanvasRelationError(
      `${locked.join(", ")} is locked; unlock it (locked: false, through tx.apply) to change it`,
    );
  }
}

/**
 * `doc` with the items `ids` moved by `by`, as the arrow keys nudge a
 * selection: the one move every other move is, its groups' members carried
 * along, and each item it lets go of belonging to the frame that holds it
 * there. Items an act may not take (`freeItems`) stay.
 */
export function nudgeItems(doc: CanvasDoc, ids: Iterable<string>, by: CanvasVec): CanvasDoc {
  const carried = carriedBy(doc.nodes, ids);
  const moved = transformCarried(doc, carried, moveBy(selectionPivot(carried.items), by));
  return settleMembership(
    moved,
    carried.items.map((item) => item.id),
  );
}
