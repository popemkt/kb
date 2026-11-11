/**
 * A node's prop edits as `node.update` applies them: the unsets first (a
 * field's every value, or the values equal to the one named), then the
 * sets, where a single-valued field's first set replaces what it held and
 * a later one in the same edit adds. It is one function so that whatever
 * asks what an update will leave (days' untag interceptor) reads the very
 * answer the action writes, never an approximation of it.
 */
import {
  cardinalityOf,
  resolveFieldIn,
  type NodeGraph,
  type NodeId,
  type PropValue,
} from "@kb/model";

/** One value set on a field, the field by name or id. */
export interface PropEntry {
  field: string;
  value: PropValue;
}

/** One unset: the field's every value, or only those equal to `value`. */
export interface PropUnset {
  readonly field: string;
  readonly value?: unknown;
}

/** What `node.update` edits of a node's props. */
export interface PropEdits {
  readonly setProps?: readonly PropEntry[] | undefined;
  readonly unsetProps?: readonly PropUnset[] | undefined;
}

/** Add `entries` to `props` in place, fields resolved in `graph`; a single-valued field's first entry replaces it. */
export function applyProps(
  graph: NodeGraph,
  props: Record<NodeId, PropValue[]>,
  entries: readonly PropEntry[],
): void {
  const replaced = new Set<NodeId>();
  for (const e of entries) {
    const fieldId = resolveFieldIn(graph, e.field);
    const single = cardinalityOf(graph.get(fieldId)?.props, (id) => graph.get(id)) === "one";
    const list = single && !replaced.has(fieldId) ? [] : (props[fieldId] ?? []);
    if (single) replaced.add(fieldId);
    list.push(e.value);
    props[fieldId] = list;
  }
}

/** The props `props` become under `edits`, fields resolved in `graph`; `props` is left as it was. */
export function projectPropEdits(
  graph: NodeGraph,
  props: Readonly<Record<NodeId, readonly PropValue[]>>,
  edits: PropEdits,
): Record<NodeId, PropValue[]> {
  const out = Object.fromEntries(
    Object.entries(props).map(([field, values]) => [field, [...values]]),
  );
  for (const u of edits.unsetProps ?? []) {
    const fieldId = resolveFieldIn(graph, u.field);
    const kept =
      u.value === undefined
        ? []
        : (out[fieldId] ?? []).filter((pv) => JSON.stringify(pv) !== JSON.stringify(u.value));
    if (kept.length === 0) delete out[fieldId];
    else out[fieldId] = kept;
  }
  // Remove old values before adding replacements in the same update.
  if (edits.setProps) applyProps(graph, out, edits.setProps);
  return out;
}
