/**
 * Which tags a node is, and which fields its tags template: the one reader
 * of each (DESIGN.md → Data model → Tags).
 *
 * A node's *chips* are its direct tags, the `sys.f.type` refs it carries
 * (`typeRefsOf`). Its *kinds* are what it is: those tags and every tag they
 * extend (`sys.f.extends`), so a `#meeting` that extends `#event` is an
 * event. Every question of membership ("is this an event?", "which nodes
 * may this field point at?", "which fields does this row show?") is asked
 * of its kinds, through {@link kindsOf} and {@link isA}, and never of the
 * chips. The two are kept apart for the same reason the badge list is kept
 * apart from the kind slot.
 *
 * A tag's chain ({@link tagAncestors}) is breadth first in declared order,
 * each tag once, so a diamond reaches a shared ancestor once and a cycle
 * ends where it closes: nothing graph-shaped throws, as the ontology
 * resolver does not. What is nearer wins wherever a chain is read in order:
 * a tag's own fields, then each ancestor's; its own views, then theirs.
 */
import type { NodeId } from "./model.ts";
import { SYSTEM_IDS } from "./model.ts";
import { refValuesOf, typeRefsOf, type NodeLike } from "./node-like.ts";

/** How a reader finds a node: the graph it is asked over. */
export type KindsLookup = (id: NodeId) => Pick<NodeLike, "props"> | undefined;

/** `tag`, then every tag it extends, breadth first in declared order, each once. */
export function tagAncestors(tag: NodeId, nodeOf: KindsLookup): NodeId[] {
  const chain = new Set<NodeId>();
  const queue: NodeId[] = [tag];
  for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
    if (chain.has(next)) continue;
    chain.add(next);
    queue.push(...refValuesOf(nodeOf(next), SYSTEM_IDS.extendsField));
  }
  return [...chain];
}

/** Every tag `node` is, each once: each tag it carries, in order, followed by its chain. */
export function kindsOf(node: Pick<NodeLike, "props"> | undefined, nodeOf: KindsLookup): NodeId[] {
  return [...new Set(typeRefsOf(node).flatMap((tag) => tagAncestors(tag, nodeOf)))];
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
 * The fields the templates of `tags` and of their chains name
 * (`sys.f.fields`), each once: the first tag's own in its order, then its
 * ancestors', then each next tag's that are not there yet. What a node of
 * those tags shows as its fields, whatever it holds. A tag cannot drop a
 * field it inherits, so every node of a tag has its ancestors' fields.
 */
export function templateFieldsOf(tags: readonly NodeId[], nodeOf: KindsLookup): NodeId[] {
  const fields = new Set<NodeId>();
  for (const tag of tags)
    for (const kind of tagAncestors(tag, nodeOf))
      for (const field of refValuesOf(nodeOf(kind), SYSTEM_IDS.fieldsField)) fields.add(field);
  return [...fields];
}
