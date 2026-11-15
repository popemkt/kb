/**
 * The outline's move of rows anywhere (DESIGN-UI.md → Outline editor, "A row
 * moves anywhere"), the one both Move to… and a drag make: the rows go as
 * one write (`PageWrites.moveNodes`), and the selection goes with them where
 * they are drawn, to the references they left, or else to the row before
 * where they were, as after Delete, a toast saying where they went.
 */
import { browserHost, type MovePlace, textOr, toast } from "@kb/ui-sdk";
import { outlineNodes, useOutlineStore } from "./outline.store";

/**
 * Move `ids`, whose rows run from instance `firstKey` to `lastKey`, to
 * `place`, leaving a reference behind each when `leaveReferences`.
 */
export async function moveRows(
  ids: readonly string[],
  rows: { readonly firstKey: string; readonly lastKey: string },
  place: MovePlace,
  leaveReferences: boolean,
): Promise<void> {
  const head = ids[0];
  const tail = ids.at(-1);
  if (head === undefined || tail === undefined) return;
  const store = useOutlineStore.getState();
  const moved = new Set(ids);
  // The row before them (else after them) that stays where it is.
  let fallback = store.getPreviousVisibleInstance(rows.firstKey);
  while (fallback !== null && moved.has(fallback.nodeId)) {
    fallback = store.getPreviousVisibleInstance(fallback.instanceKey);
  }
  fallback ??= store.getNextVisibleInstance(rows.lastKey);
  const made = await browserHost().writes.moveNodes(ids, place, leaveReferences);
  if (made === null) return;
  const after = useOutlineStore.getState();
  const [first] = made.references;
  const last = made.references.at(-1);
  if (first !== undefined && last !== undefined) {
    after.selectRange(first, last);
    return;
  }
  after.selectRange(head, tail);
  if (useOutlineStore.getState().selectedRows().length > 0) return;
  // Not drawn where they went: the selection stays near where they were,
  // and a toast says where they went.
  if (fallback === null) after.selectNode(null);
  else after.selectNode(fallback.nodeId, fallback.instanceKey);
  const where =
    place.parent === null
      ? "the top level"
      : textOr(outlineNodes().get(place.parent)?.text.trim(), "a node");
  toast(`${ids.length === 1 ? "Moved" : `Moved ${ids.length} nodes`} to ${where}`, "info");
}
