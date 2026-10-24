import {
  itemKind,
  itemWords,
  pinnedItems,
  type CanvasDoc,
  type CanvasWorld,
  type CommentAnchor,
} from "@kb/canvas";

/** The longest a target's words run before they are cut. */
const MAX_WORDS = 40;

/**
 * What a thread is on, in words: the item's kind and what it says
 * (`itemKind`, `itemWords`), "a point" for a point, and "nothing" for a pin
 * that is lost.
 */
export function targetLabel(
  anchor: CommentAnchor | null,
  doc: CanvasDoc,
  world: CanvasWorld,
): string {
  if (anchor === null) return "nothing";
  if ("at" in anchor) return "a point";
  const item = pinnedItems(anchor, doc)[0];
  if (item === undefined) return "nothing";
  const words = itemWords(item, world).trim().replaceAll(/\s+/g, " ");
  const said = words.length <= MAX_WORDS ? words : `${words.slice(0, MAX_WORDS - 1)}…`;
  return said === "" ? itemKind(item) : `${itemKind(item)} · ${said}`;
}
