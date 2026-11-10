/**
 * Which tags a node is, and which fields its tags template: the one reader
 * of each (DESIGN.md → Data model → Tags).
 *
 * A node's *chips* are its direct tags, the `sys.f.type` refs it carries
 * (`typeRefsOf`). Its *kinds* are what it is: every question of membership
 * ("is this an event?", "which nodes may this field point at?", "which
 * fields does this row show?") is asked of its kinds, through
 * {@link kindsOf} and {@link isA}, and never of the chips. The two are kept
 * apart for the same reason the badge list is kept apart from the kind slot.
 */
import type { NodeId } from "./model.ts";
import { SYSTEM_IDS } from "./model.ts";
import { refValuesOf, typeRefsOf, type NodeLike } from "./node-like.ts";

/** How a reader finds a node: the graph it is asked over. */
export type KindsLookup = (id: NodeId) => Pick<NodeLike, "props"> | undefined;

/** Every tag `node` is, each once, in the order it carries them. */
export function kindsOf(node: Pick<NodeLike, "props"> | undefined, _nodeOf: KindsLookup): NodeId[] {
  return [...new Set(typeRefsOf(node))];
}

/** Whether `node` is a `tag`. */
export function isA(
  node: Pick<NodeLike, "props"> | undefined,
  tag: NodeId,
  nodeOf: KindsLookup,
): boolean {
  return kindsOf(node, nodeOf).includes(tag);
}

/**
 * The fields the templates of `tags` name (`sys.f.fields`), each once: the
 * first tag's in its order, then each next tag's that are not there yet.
 * What a node of those tags shows as its fields, whatever it holds.
 */
export function templateFieldsOf(tags: readonly NodeId[], nodeOf: KindsLookup): NodeId[] {
  const fields = new Set<NodeId>();
  for (const tag of tags)
    for (const field of refValuesOf(nodeOf(tag), SYSTEM_IDS.fieldsField)) fields.add(field);
  return [...fields];
}
