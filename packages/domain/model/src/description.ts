/**
 * A node's description (DESIGN.md → Data model → Descriptions): a short
 * text on any node, `sys.f.description`, that says what the node is for.
 * Surfaces draw it under the node's name (a row, a page's title) and as the
 * hint beside it where the node is offered (pickers, search); it is the
 * node's value like any other, so this is the one reader of it.
 */
import { SYSTEM_IDS, type NodeId, type PropValue } from "./model.ts";

/** The text `node` describes itself with, trimmed, or null when it has none. */
export function descriptionOf(
  node: { readonly props: Readonly<Record<NodeId, readonly PropValue[]>> } | undefined,
): string | null {
  const text = node?.props[SYSTEM_IDS.descriptionField]
    ?.find((value) => value.t === "str")
    ?.v.trim();
  return text === undefined || text === "" ? null : text;
}
