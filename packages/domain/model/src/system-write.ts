/**
 * Which writes to a system node are a person's to make (DESIGN.md → Data
 * model → write protection, Extension families → configuration).
 *
 * A `sys.*` node is seeded and code reads its shape, so it is written only
 * with `force`, with one exception the graph itself declares: a system field
 * that carries `sys.f.configures`, a ref to an extension's node, to their
 * list `sys.extensions` (every one of them), or to a kind (`sys.tag`: every
 * tag), is a setting of what it names, and its
 * values there are written like any field's values on any node. The field must itself be a system field: only the
 * owner's `force` mints or retargets one, so a field anyone may add cannot
 * declare itself a setting of a node it does not own. Nothing else of a
 * system node is a person's to write: not its text, its children, its rank,
 * nor a field that does not configure it. The switch
 * (`sys.f.extension.enabled`, which configures every extension's node) is a
 * setting like any other, and `extension.switch` writes it through the same
 * rule.
 *
 * One statement for every surface. The commit refuses a transaction that
 * breaks it ({@link systemTxRefusal}, read by `persistEffect` in
 * `@kb/operations`, its one owner), on the server and on the page's replica
 * alike, and the page's field rows read {@link isWritableField} to offer an
 * edit only where the write would land.
 */
import { SYSTEM_IDS, isExtensionNodeId, isSysPrefixed, type KbNode, type NodeId } from "./model.ts";
import { refValuesOf, typeRefsOf, type NodeLike } from "./ontology.ts";

/** One node a call writes: as it was (absent when new) and as it will be (absent when deleted). */
export interface NodeWrite {
  readonly before: KbNode | undefined;
  readonly after: KbNode | undefined;
}

/**
 * The node a setting is checked against: its id, and its props where they
 * are at hand (its kinds, `sys.f.type`, are what a setting of a kind reads).
 */
export interface Configured {
  readonly id: NodeId;
  readonly props?: NodeLike["props"];
}

/** How a write finds the nodes it is checked against: the graph before it. */
export type NodeOf = (id: NodeId) => Pick<NodeLike, "props"> | undefined;

/**
 * Whether the field `fieldId` (its node `fieldNode`) is a setting of
 * `node`: a system field whose `sys.f.configures` names that node, names
 * `sys.extensions` where the node is an extension's, or names a kind the
 * node is (one of its `sys.f.type` refs: `sys.tag` for every tag).
 */
export function configures(
  fieldId: NodeId,
  fieldNode: Pick<NodeLike, "props"> | undefined,
  node: Configured,
): boolean {
  if (!isSysPrefixed(fieldId)) return false;
  const named = refValuesOf(fieldNode, SYSTEM_IDS.configuresField);
  const kinds = node.props === undefined ? [] : typeRefsOf({ props: node.props });
  return named.some((target) =>
    target === SYSTEM_IDS.extensionsRoot
      ? isExtensionNodeId(node.id)
      : target === node.id || kinds.includes(target),
  );
}

/**
 * Whether the system node `id` (its node `node`) configures an extension:
 * its `sys.f.configures` names an extension's node or their list. A field
 * that does is a setting; a tag that does is a kind whose nodes are that
 * extension's configuration (the agent's `#agent-provider`).
 */
export function configuresAnExtension(
  id: NodeId,
  node: Pick<NodeLike, "props"> | undefined,
): boolean {
  if (!isSysPrefixed(id)) return false;
  return refValuesOf(node, SYSTEM_IDS.configuresField).some(
    (target) => target === SYSTEM_IDS.extensionsRoot || isExtensionNodeId(target),
  );
}

function sameValues(
  a: KbNode["props"][string] | undefined,
  b: KbNode["props"][string] | undefined,
) {
  return JSON.stringify(a ?? []) === JSON.stringify(b ?? []);
}

/** The fields whose values differ between `before` and `after`. */
export function changedFields(before: KbNode | undefined, after: KbNode | undefined): string[] {
  const fields = new Set([...Object.keys(before?.props ?? {}), ...Object.keys(after?.props ?? {})]);
  return [...fields].filter((field) => !sameValues(before?.props[field], after?.props[field]));
}

/**
 * Whether a person may write values of the field `fieldId` (its node
 * `fieldNode`) on `node` without force: on any node that is not a system
 * node, and on a system node only where the field is one of its settings.
 */
export function isWritableField(
  node: Configured,
  fieldId: NodeId,
  fieldNode: Pick<NodeLike, "props"> | undefined,
): boolean {
  return !isSysPrefixed(node.id) || configures(fieldId, fieldNode, node);
}

/**
 * Why writing `next` over `before` (the node as the graph holds it now,
 * absent for a new one) is not a person's to make without force, or null
 * when it is. A node that is not a system node is always theirs. A system
 * node may change only in the values of fields that configure it, as
 * `fieldOf` reads those fields; minting one is never a person's write.
 */
export function systemWriteRefusal(
  before: KbNode | undefined,
  next: KbNode,
  fieldOf: NodeOf,
): string | null {
  if (!isSysPrefixed(next.id)) return null;
  const protectedWrite = `sys.* nodes are write-protected (use force to override): ${next.id}`;
  if (before === undefined) return protectedWrite;
  if (
    before.text !== next.text ||
    before.order !== next.order ||
    before.createdAt !== next.createdAt ||
    JSON.stringify(before.children) !== JSON.stringify(next.children)
  ) {
    return protectedWrite;
  }
  for (const field of changedFields(before, next)) {
    if (!isWritableField(before, field, fieldOf(field))) return protectedWrite;
  }
  return null;
}

/**
 * Why committing `tx` over the graph `nodeOf` reads is not a person's to make
 * without force, and which node it is refused for, or null when it is: an
 * upsert {@link systemWriteRefusal} refuses, or the deletion of a system node.
 */
export function systemTxRefusal(
  tx: { readonly upserts: readonly KbNode[]; readonly deletes: readonly NodeId[] },
  nodeOf: (id: NodeId) => KbNode | undefined,
): { readonly id: NodeId; readonly message: string } | null {
  for (const next of tx.upserts) {
    const message = systemWriteRefusal(nodeOf(next.id), next, nodeOf);
    if (message !== null) return { id: next.id, message };
  }
  const deleted = tx.deletes.find((id) => isSysPrefixed(id));
  return deleted === undefined
    ? null
    : {
        id: deleted,
        message: `sys.* nodes are write-protected (use force to override): ${deleted}`,
      };
}
