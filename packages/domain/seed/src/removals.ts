import {
  ADDITIVE_FIELDS,
  isSysPrefixed,
  type KbNode,
  type NodeId,
  type SeedRetirement,
  type StoreTx,
} from "@kb/model";

type NodeOf = (id: NodeId) => KbNode | undefined;

/** A seed choice is an ordinary system node with an identity derived from the slot it clears. */
function choiceId(node: NodeId, field?: NodeId): NodeId {
  return `sys.seed.removed.${encodeURIComponent(JSON.stringify(field === undefined ? [node] : [node, field]))}`;
}

/** Read a choice by current or retired ids, the same identities the seed recognizes. */
export function seedRemovalLookup(
  nodes: ReadonlyMap<NodeId, KbNode>,
  retired: readonly SeedRetirement[],
): (node: NodeId, field?: NodeId) => boolean {
  const previous = new Map<NodeId, NodeId[]>();
  for (const { from, to } of retired) {
    if (to === undefined || from === to) continue;
    const aliases = previous.get(to) ?? [to];
    aliases.push(from);
    previous.set(to, aliases);
  }
  return (node, field) =>
    (previous.get(node) ?? [node]).some((id) =>
      field === undefined
        ? nodes.has(choiceId(id))
        : (previous.get(field) ?? [field]).some((key) => nodes.has(choiceId(id, key))),
    );
}

/** Choices made by this write, to land atomically with it. Existing choices need no update. */
export function seedRemovalNodes(
  tx: StoreTx,
  nodeOf: NodeOf,
  seeded: (id: NodeId) => boolean,
  at: string,
): KbNode[] {
  const choices: KbNode[] = [];
  const suppress = (node: NodeId, field?: NodeId) => {
    const id = choiceId(node, field);
    if (nodeOf(id) !== undefined) return;
    const text =
      field === undefined
        ? `Seed default removed: ${node}`
        : `Seed default cleared: ${node} / ${field}`;
    choices.push({ id, text, props: {}, children: [], createdAt: at, updatedAt: at });
  };
  for (const node of tx.upserts) {
    const before = nodeOf(node.id);
    if (before === undefined || before.props === node.props) continue;
    const cleared = Object.entries(before.props).filter(
      ([field, values]) =>
        values.length > 0 && (node.props[field]?.length ?? 0) === 0 && !ADDITIVE_FIELDS.has(field),
    );
    if (cleared.length === 0 || !seeded(node.id)) continue;
    for (const [field] of cleared) suppress(node.id, field);
  }
  for (const id of tx.deletes) {
    if (!isSysPrefixed(id) && seeded(id)) suppress(id);
  }
  return choices;
}
