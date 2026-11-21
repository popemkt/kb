/**
 * A node's description (DESIGN.md → Data model → Descriptions): a short
 * text on any node, `sys.f.description`, that says what the node is for.
 * Surfaces draw it under the node's name (a row, a page's title) and as the
 * hint beside it where the node is offered (pickers, search); it is the
 * node's value like any other, so this is the one reader of it.
 */
import { SYSTEM_IDS, type NodeId, type PropValue } from "./model.ts";

type Described = { readonly props: Readonly<Record<NodeId, readonly PropValue[]>> } | undefined;

/**
 * The value `node` holds as its description, as stored: what an edit
 * replaces and a removal takes out, whatever space it was written with.
 */
export function descriptionValueOf(node: Described): Extract<PropValue, { t: "str" }> | null {
  return node?.props[SYSTEM_IDS.descriptionField]?.find((value) => value.t === "str") ?? null;
}

/** The text `node` describes itself with, trimmed, or null when it has none. */
export function descriptionOf(node: Described): string | null {
  const text = descriptionValueOf(node)?.v.trim();
  return text === undefined || text === "" ? null : text;
}
