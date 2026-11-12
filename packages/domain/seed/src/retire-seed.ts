/** Apply a declared retirement table without rewriting user edits. */
import type { KbNode, NodeId, PropValue, SeedRetirement } from "@kb/model";

/** What each retired id becomes: its replacement, or null where nothing replaced it. */
type Replacements = ReadonlyMap<NodeId, NodeId | null>;

/** `values` with each ref to a retired id moved to its replacement (or dropped), once each. */
function remapValues(values: readonly PropValue[], to: Replacements): readonly PropValue[] {
  if (!values.some((value) => value.t === "ref" && to.has(value.v))) return values;
  const seen = new Set<NodeId>();
  const out: PropValue[] = [];
  for (const value of values) {
    if (value.t !== "ref") {
      out.push(value);
      continue;
    }
    const target = to.has(value.v) ? to.get(value.v) : value.v;
    if (target === null || target === undefined || seen.has(target)) continue;
    seen.add(target);
    out.push(target === value.v ? value : { t: "ref", v: target });
  }
  return out;
}

/** `values` followed by those of `more` it does not hold yet, compared whole. */
function unionValues(values: readonly PropValue[], more: readonly PropValue[]): PropValue[] {
  const held = new Set(values.map((value) => JSON.stringify(value)));
  return [...values, ...more.filter((value) => !held.has(JSON.stringify(value)))];
}

/**
 * `props` with each key a retired field moved to its replacement's key
 * (where the node holds none under it already: the replacement's own value
 * wins) or dropped, and each ref value remapped. Two retired fields one
 * replacement took over pool their values under it, once each. The same
 * object when nothing changes.
 */
function remapProps(props: KbNode["props"], to: Replacements): KbNode["props"] {
  let changed = false;
  const out: Record<NodeId, PropValue[]> = {};
  for (const [field, values] of Object.entries(props)) {
    const key = to.has(field) ? to.get(field) : field;
    const remapped = remapValues(values, to);
    if (key !== field || remapped !== values) changed = true;
    if (key === null || key === undefined) continue;
    if (key !== field && key in props) continue;
    const pooled = out[key];
    out[key] = pooled === undefined ? [...remapped] : unionValues(pooled, remapped);
  }
  return changed ? out : props;
}

/** `children` with each retired id moved to its replacement (or dropped), once each. */
function remapChildren(children: readonly NodeId[], to: Replacements): readonly NodeId[] {
  if (!children.some((id) => to.has(id))) return children;
  const seen = new Set<NodeId>();
  const out: NodeId[] = [];
  for (const id of children) {
    const next = to.has(id) ? to.get(id) : id;
    if (next === null || next === undefined || seen.has(next)) continue;
    seen.add(next);
    out.push(next);
  }
  return out;
}

/** `text` with each `[[id]]` or `[[id|label]]` of a replaced id naming its replacement. */
function remapText(text: string, to: Replacements): string {
  let out = text;
  for (const [from, next] of to) {
    if (next === null || !out.includes(`[[${from}`)) continue;
    out = out.split(`[[${from}]]`).join(`[[${next}]]`).split(`[[${from}|`).join(`[[${next}|`);
  }
  return out;
}

/**
 * Apply `rows` to the store's nodes, by id, in place, before the seed is
 * merged in:
 *
 * - a retired node is deleted. Where its replacement is not in the store
 *   yet, it is renamed in place, keeping its text, props and children (an
 *   edit made on the old id survives); where it is, the replacement keeps
 *   its own and gains the props it lacks and the children it does not
 *   list.
 * - on every node, a prop keyed by a retired field is keyed by its
 *   replacement, a ref value naming a retired id names its replacement, a
 *   child list names the replacement in the old one's place, and a
 *   `[[ref]]` in text follows too. Where nothing replaced an id, its key,
 *   values and child entries are dropped (a mention in text is left, and
 *   shows as missing).
 * - a replacement that still reads a retired label takes the text the seed
 *   writes on it now (`seededText`).
 *
 * Returns the ids deleted and whether anything changed.
 */
export function retireSeeded(
  byId: Map<NodeId, KbNode>,
  rows: readonly SeedRetirement[],
  seededText: (id: NodeId) => string | undefined,
): { readonly deletes: NodeId[]; readonly changed: boolean } {
  const renames = rows.filter(({ from, to }) => from !== to);
  const to: Replacements = new Map(renames.map(({ from, to: next }) => [from, next ?? null]));
  const deletes: NodeId[] = [];
  let changed = false;
  for (const { from, to: next } of renames) {
    const old = byId.get(from);
    if (old === undefined) continue;
    byId.delete(from);
    deletes.push(from);
    changed = true;
    if (next === undefined) continue;
    const kept = byId.get(next);
    if (kept === undefined) {
      byId.set(next, { ...old, id: next });
      continue;
    }
    const children = [
      ...kept.children,
      ...old.children.filter((id) => !kept.children.includes(id)),
    ];
    byId.set(next, { ...kept, props: { ...old.props, ...kept.props }, children });
  }
  for (const [id, node] of byId) {
    const props = remapProps(node.props, to);
    const children = remapChildren(node.children, to);
    const text = remapText(node.text, to);
    if (props === node.props && children === node.children && text === node.text) continue;
    byId.set(id, { ...node, props, children: [...children], text });
    changed = true;
  }
  for (const { to: next, text: was } of rows) {
    if (next === undefined || was === undefined) continue;
    const node = byId.get(next);
    const now = seededText(next);
    if (node === undefined || now === undefined || node.text !== was) continue;
    byId.set(next, { ...node, text: now });
    changed = true;
  }
  return { deletes, changed };
}
