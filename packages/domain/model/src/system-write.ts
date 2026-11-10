/**
 * Which writes to a system node are a person's to make (DESIGN.md → Data
 * model → write protection; AGENTS.md → Data-plane freedom).
 *
 * A `sys.*` node is seeded, and its owner's code reads its id and what it
 * ships: the ids its seeded lists hold, in order. That is all the rule
 * keeps. Ownership follows the id, so the rule needs no record of what was
 * seeded: a `sys.*` id in a seeded node's list is its owner's, and any other
 * id there is a person's.
 *
 * - **Its text is the person's.** A label is cosmetic; code names the node by
 *   its id, and the seed keeps an edited label on every open.
 * - **Its lists are additive.** Its children and its tag's template
 *   ({@link ADDITIVE_FIELDS}) take a person's ids anywhere among the
 *   seeded ones, and give them back, as long as every `sys.*` id the list
 *   held stays, in the order it held them ({@link keepsSeeded}).
 * - **Its settings are the person's.** A system field that carries
 *   `sys.f.configures`, naming the node, their list `sys.extensions` (every
 *   extension's node) or a kind the node is (`sys.tag`: every tag), is a
 *   setting of it, written like any field's values on any node. The field
 *   must itself be a system field: only the owner's `force` mints or
 *   retargets one, so a field anyone may add cannot declare itself a setting
 *   of a node it does not own. The switch (`sys.f.extension.enabled`) is a
 *   setting like any other, and `extension.switch` writes it through the
 *   same rule.
 * - **The rest is its owner's.** Minting or deleting a system node, its rank
 *   and creation stamp, and the values of any other field are written only
 *   with `force`.
 *
 * The rule is actor-neutral: "a person" is whoever makes the call, so an
 * agent over MCP or HTTP, a family's action and a reaction write under it
 * as the page does. It says only what the commit refuses; the guards,
 * intercepts and approvals a call passes through apply as they did.
 *
 * One statement for every surface. The commit refuses a transaction that
 * breaks it ({@link systemTxRefusal}, read by `persistEffect` in
 * `@kb/operations`, its one owner), on the server and on the page's replica
 * alike, and the page's field rows read {@link isWritableField} to offer an
 * edit only where the write would land.
 */
import { SYSTEM_IDS, isExtensionNodeId, isSysPrefixed, type KbNode, type NodeId } from "./model.ts";
import { changedFields } from "./tx.ts";
import { refValuesOf, typeRefsOf, type NodeLike } from "./node-like.ts";
import type { SystemRefusal } from "./write-refusal.ts";

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
 * The fields whose values on a system node are a list a person may add to
 * ({@link keepsSeeded}): a tag's template, `sys.f.fields`, and the tags it
 * extends, `sys.f.extends`. A node's children are the other such list. The
 * seed unions what it ships into each of them (`ensureSystemSeed`).
 */
export const ADDITIVE_FIELDS: ReadonlySet<NodeId> = new Set([
  SYSTEM_IDS.fieldsField,
  SYSTEM_IDS.extendsField,
]);

/**
 * Whether `id`, in one of the lists of the node `holder` (its children, or
 * an {@link ADDITIVE_FIELDS} value), is what `holder`'s owner ships there: a
 * system id in a system node's list. The commit keeps it, in its place; any
 * other id there is a person's, theirs to take back.
 */
export function isShipped(holder: NodeId, id: NodeId): boolean {
  return isSysPrefixed(holder) && isSysPrefixed(id);
}

/**
 * Whether `next`, a list of the system node `holder`, keeps what `before`
 * ships ({@link isShipped}): every such id, in the order it holds them.
 * Every other id is a person's, added, moved or taken back as they like.
 */
function keepsSeeded(holder: NodeId, before: readonly NodeId[], next: readonly NodeId[]): boolean {
  const ships = (id: NodeId) => isShipped(holder, id);
  const shipped = before.filter(ships);
  const kept = next.filter(ships);
  return shipped.length === kept.length && shipped.every((id, at) => kept[at] === id);
}

/** The node ids `values` hold: what an additive field's list is made of. */
const idsOf = (values: KbNode["props"][string] | undefined): NodeId[] =>
  (values ?? []).flatMap((value) => (value.t === "ref" ? [value.v] : []));

/**
 * Why writing `next` over `before` (the node as the graph holds it now,
 * absent for a new one) is not a person's to make without force, or null
 * when it is. A node that is not a system node is always theirs. A system
 * node takes a new text, a person's ids in its additive lists, and the
 * values of the fields that configure it, as `fieldOf` reads those fields;
 * minting one is never a person's write.
 */
export function systemWriteRefusal(
  before: KbNode | undefined,
  next: KbNode,
  fieldOf: NodeOf,
): SystemRefusal | null {
  if (!isSysPrefixed(next.id)) return null;
  const id = next.id;
  if (before === undefined) return { rule: "mint", id };
  if (before.order !== next.order) return { rule: "rank", id };
  if (before.createdAt !== next.createdAt) return { rule: "stamp", id };
  if (!keepsSeeded(id, before.children, next.children)) return { rule: "children", id };
  for (const field of changedFields(before, next)) {
    if (ADDITIVE_FIELDS.has(field)) {
      if (!keepsSeeded(id, idsOf(before.props[field]), idsOf(next.props[field])))
        return { rule: "list", id, field };
    } else if (!isWritableField(before, field, fieldOf(field))) {
      return { rule: "setting", id, field };
    }
  }
  return null;
}

/**
 * Why committing `tx` over the graph `nodeOf` reads is not a person's to make
 * without force, or null when it is: the deletion of a system node, or an
 * upsert {@link systemWriteRefusal} refuses. A deletion is asked first: the
 * transaction that deletes a seeded node also takes it from its parent's
 * list, and the node deleted is what the write is about.
 */
export function systemTxRefusal(
  tx: { readonly upserts: readonly KbNode[]; readonly deletes: readonly NodeId[] },
  nodeOf: (id: NodeId) => KbNode | undefined,
): SystemRefusal | null {
  const deleted = tx.deletes.find((id) => isSysPrefixed(id));
  if (deleted !== undefined) return { rule: "delete", id: deleted };
  for (const next of tx.upserts) {
    const refusal = systemWriteRefusal(nodeOf(next.id), next, nodeOf);
    if (refusal !== null) return refusal;
  }
  return null;
}
