/**
 * What a node write means over a graph, stated once for every writer: core's
 * `node.add`, `node.addTree` and `node.update`, a view proposal, and a family
 * planning its own write (a canvas import, a day's missing periods, days'
 * untag interceptor). It is pure — a graph in, the graph or the props out —
 * so a planner with no services (a capture target, an interceptor) reads the
 * very answer the action writes, never an approximation of it.
 *
 * A prop edit is `node.update`'s: the unsets first (a field's every value, or
 * the values equal to the one named), then the sets, where a single-valued
 * field's first set replaces what it held and a later one in the same edit
 * adds.
 */
import { cardinalityOf } from "./field-type.ts";
import { SYSTEM_IDS, type KbNode, type NodeId, type PropValue } from "./model.ts";
import type { NodeGraph } from "./node-graph.ts";
import { rankForInsert, type SiblingGroups } from "./order.ts";
import { ResolveError, resolveFieldIn, resolveTagIn } from "./resolve.ts";

/** One value set on a field, the field by name or id. */
export interface PropEntry {
  field: string;
  value: PropValue;
}

/** One unset: the field's every value, or only those equal to `value`. */
interface PropUnset {
  readonly field: string;
  readonly value?: unknown;
}

/** What `node.update` edits of a node's props. */
export interface PropEdits {
  readonly setProps?: readonly PropEntry[] | undefined;
  readonly unsetProps?: readonly PropUnset[] | undefined;
}

/** Add `entries` to `props` in place, fields resolved in `nodes`; a single-valued field's first entry replaces it. */
function applyProps(
  nodes: NodeGraph,
  props: Record<NodeId, PropValue[]>,
  entries: readonly PropEntry[],
): void {
  const replaced = new Set<NodeId>();
  for (const e of entries) {
    const fieldId = resolveFieldIn(nodes, e.field);
    const single = cardinalityOf(nodes.get(fieldId)?.props, (id) => nodes.get(id)) === "one";
    const list = single && !replaced.has(fieldId) ? [] : (props[fieldId] ?? []);
    if (single) replaced.add(fieldId);
    list.push(e.value);
    props[fieldId] = list;
  }
}

/** The props `props` become under `edits`, fields resolved in `nodes`; `props` is left as it was. */
export function projectPropEdits(
  nodes: NodeGraph,
  props: Readonly<Record<NodeId, readonly PropValue[]>>,
  edits: PropEdits,
): Record<NodeId, PropValue[]> {
  const out = Object.fromEntries(
    Object.entries(props).map(([field, values]) => [field, [...values]]),
  );
  for (const u of edits.unsetProps ?? []) {
    const fieldId = resolveFieldIn(nodes, u.field);
    const kept =
      u.value === undefined
        ? []
        : (out[fieldId] ?? []).filter((pv) => JSON.stringify(pv) !== JSON.stringify(u.value));
    if (kept.length === 0) delete out[fieldId];
    else out[fieldId] = kept;
  }
  // Remove old values before adding replacements in the same update.
  if (edits.setProps) applyProps(nodes, out, edits.setProps);
  return out;
}

/**
 * The rank a node takes when it is placed at `position` in the sibling group
 * under `parent` (the forest roots when null), read from `groups` — the state
 * before the placement, which is why the node itself is excluded. The one
 * owner of the answer is `@kb/model`'s `rankForInsert`; the store's commit
 * settles it again against whatever it merges into.
 */
export function placedRank(
  groups: SiblingGroups<KbNode>,
  parent: NodeId | null,
  node: KbNode,
  position: number | undefined,
): string {
  const siblings = groups.slots(parent, node.id);
  return rankForInsert(siblings, position ?? siblings.length, node.order);
}

/**
 * What one add says, whoever says it: `node.add`'s input, its props as
 * values of the model, and its place decided: under `parent`, or at the
 * top level without one.
 */
export interface NodeAddPlanInput {
  readonly text: string;
  readonly props?: readonly PropEntry[] | undefined;
  readonly tags?: readonly string[] | undefined;
  readonly parent?: NodeId | undefined;
  readonly position?: number | undefined;
}

/**
 * What one add means, stated once: the new node, and its parent with the
 * child filed in, written into `nodes` (checked, not stored). It returns the
 * ids it wrote; reading them back from `nodes` gives the upserts. It throws
 * {@link ResolveError}, and a refused add writes nothing; the effects below
 * lift it into a `DomainError`.
 */
export function planNodeAdd(
  nodes: NodeGraph,
  input: NodeAddPlanInput,
  id: NodeId,
  at: string,
): { node: KbNode; written: NodeId[] } {
  if (nodes.has(id)) {
    throw new ResolveError("ambiguous", `node id already exists: ${id}`, { id });
  }

  const props: Record<NodeId, PropValue[]> = {};
  if (input.props) applyProps(nodes, props, input.props);
  if (input.tags) {
    for (const tagName of input.tags) {
      const tagId = resolveTagIn(nodes, tagName);
      const list = props[SYSTEM_IDS.typeField] ?? [];
      list.push({ t: "ref", v: tagId });
      props[SYSTEM_IDS.typeField] = list;
    }
  }

  const draft: KbNode = { id, text: input.text, props, children: [], createdAt: at, updatedAt: at };
  const parentId = input.parent;
  const node: KbNode = {
    ...draft,
    order: placedRank(nodes, parentId ?? null, draft, input.position),
  };
  const written = parentId === undefined ? [id] : [id, parentId];
  if (parentId !== undefined && !nodes.has(parentId)) {
    throw new ResolveError("not_found", `node not found: ${parentId}`, { id: parentId });
  }
  // Filed before it is put, so the node never passes through the roots.
  if (parentId !== undefined) nodes.insertChild(parentId, id, input.position, at);
  nodes.put(node);
  return { node, written };
}
