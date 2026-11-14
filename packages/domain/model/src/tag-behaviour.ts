/**
 * How a tag shapes the nodes it is on (DESIGN.md → Data model → tag
 * behaviours): the child tags a node added under one of its nodes gets, the
 * fields a gained tag fills from the node's ancestors, the title a node is
 * named by, and the box it shows. Each is a field read along a node's
 * kinds, nearest first, and this module is the one reader of them all: the
 * write plans call the first two inside the write that makes or tags a
 * node, every surface that names a node asks the third, and every surface
 * that draws or toggles a box the fourth.
 */
import { cardinalityOf, fieldTypeOf } from "./field-type.ts";
import { conformsToType } from "./field-value.ts";
import { replaceMentions } from "./mention.ts";
import { SYSTEM_IDS, type NodeId, type PropValue } from "./model.ts";
import type { NodeLike } from "./node-like.ts";
import { refValuesOf, typeRefsOf } from "./node-like.ts";
import type { PropEdits } from "./node-write.ts";
import type { NodeLookup } from "./ref-chain.ts";
import { kindsOf, templateFieldsOf } from "./tag-kinds.ts";

/** The first value `field` holds on the first of `kinds` that holds one, nearest first. */
function nearestSetting(kinds: readonly NodeId[], field: NodeId, nodeOf: NodeLookup) {
  for (const kind of kinds) {
    const value = nodeOf(kind)?.props[field]?.[0];
    if (value !== undefined) return value;
  }
  return undefined;
}

/**
 * The tags a node added under `parent` also gets: each child tag its kinds
 * name (`sys.f.tag.childTag`), nearest kind first, each once.
 */
export function childTagsOf(parent: Pick<NodeLike, "props"> | undefined, nodeOf: NodeLookup) {
  const tags = new Set<NodeId>();
  for (const kind of kindsOf(parent, nodeOf))
    for (const tag of refValuesOf(nodeOf(kind), SYSTEM_IDS.tagChildTagField)) tags.add(tag);
  return [...tags];
}

/** What filling reads: nodes by id and each node's parent. */
export interface FillGraph {
  get(id: NodeId): Pick<NodeLike, "props"> | undefined;
  parentOf(id: NodeId): NodeId | undefined;
}

/** The values of `source` on the nearest of `from` and its ancestors that holds ones `type` accepts. */
function nearestValues(
  nodes: FillGraph,
  from: NodeId | undefined,
  source: NodeId,
  accepts: (value: PropValue) => boolean,
): PropValue[] {
  const seen = new Set<NodeId>();
  for (let at = from; at !== undefined && !seen.has(at); at = nodes.parentOf(at)) {
    seen.add(at);
    const held = (nodes.get(at)?.props[source] ?? []).filter(accepts);
    if (held.length > 0) return held;
  }
  return [];
}

/**
 * `props` with each field the `gained` tags template filled from the
 * node's ancestors, where the node holds none of it and the field names a
 * field to fill from (`sys.f.fillFrom`): the values of the nearest
 * ancestor, from `parent` up, holding values of that field the field can
 * hold, the first only for a one-valued field. `props` is left as it was;
 * the same object comes back when nothing fills.
 */
export function fillOnTagging(
  nodes: FillGraph,
  props: Readonly<Record<NodeId, PropValue[]>>,
  parent: NodeId | undefined,
  gained: readonly NodeId[],
): Record<NodeId, PropValue[]> {
  const nodeOf = (id: NodeId) => nodes.get(id);
  let out: Record<NodeId, PropValue[]> | null = null;
  for (const field of templateFieldsOf(gained, nodeOf)) {
    if ((props[field]?.length ?? 0) > 0) continue;
    const fieldNode = nodes.get(field);
    const source = refValuesOf(fieldNode, SYSTEM_IDS.fillFromField)[0];
    if (source === undefined) continue;
    const type = fieldTypeOf(fieldNode?.props, nodeOf);
    const values = nearestValues(
      nodes,
      parent,
      source,
      // An empty string is a field cleared, not a value to copy.
      (value) => !(value.t === "str" && value.v === "") && conformsToType(type, value),
    );
    if (values.length === 0) continue;
    out ??= { ...props };
    out[field] = cardinalityOf(fieldNode?.props, nodeOf) === "one" ? values.slice(0, 1) : values;
  }
  return out ?? props;
}

/** The tags `next` names that `before` did not. */
export function gainedTags(
  before: Readonly<Record<NodeId, readonly PropValue[]>>,
  next: Readonly<Record<NodeId, readonly PropValue[]>>,
): NodeId[] {
  const had = new Set(typeRefsOf({ props: before }));
  return typeRefsOf({ props: next }).filter((tag) => !had.has(tag));
}

/** What a title reads of a node: its text and its props. */
type Titled = Pick<NodeLike, "text" | "props">;

/** `value` as a title shows it; a ref by its target's title. */
function valueText(
  value: PropValue,
  nodeOf: (id: NodeId) => Titled | undefined,
  seen: ReadonlySet<NodeId>,
): string {
  if (value.t !== "ref") return String(value.v);
  const target = nodeOf(value.v);
  if (target === undefined || seen.has(value.v)) return target?.text ?? value.v;
  return titleWithin(value.v, target, nodeOf, seen);
}

function titleWithin(
  id: NodeId,
  node: Titled,
  nodeOf: (id: NodeId) => Titled | undefined,
  seen: ReadonlySet<NodeId>,
): string {
  const template = nearestSetting(kindsOf(node, nodeOf), SYSTEM_IDS.tagTitleField, nodeOf);
  if (template?.t !== "str") return node.text;
  const within = new Set([...seen, id]);
  // The fields the template names that the node holds no value of.
  const empty: NodeId[] = [];
  const title = replaceMentions(template.v, (span) => {
    if (span.id === SYSTEM_IDS.nodeTextField) return node.text;
    const values = node.props[span.id] ?? [];
    if (values.length === 0) empty.push(span.id);
    return values.map((value) => valueText(value, nodeOf, within)).join(", ");
  });
  return empty.length === 0 ? title : node.text;
}

/**
 * The name a node is shown by (`sys.f.tag.title`): its nearest kind's title
 * template with each field it names replaced by the node's values of it,
 * once every one holds a value; else, and with no template, its text. A
 * display rule: the stored text is never written by it.
 */
export function nodeTitleOf(
  id: NodeId,
  node: Titled,
  nodeOf: (id: NodeId) => Titled | undefined,
): string {
  return titleWithin(id, node, nodeOf, new Set());
}

/**
 * A node's box: the field it is tied to, the value that checks it, and
 * whether the node holds that value. The box holds nothing of its own.
 */
export interface NodeCheck {
  readonly field: NodeId;
  readonly value: PropValue;
  readonly checked: boolean;
}

const CHECKED: PropValue = { t: "bool", v: true };
const UNCHECKED: PropValue = { t: "bool", v: false };

const sameValue = (a: PropValue, b: PropValue) => a.t === b.t && a.v === b.v;

/**
 * The box of a node (`sys.f.tag.check`), or null when none of its kinds
 * names one: the nearest kind that does, its checked value
 * (`sys.f.tag.checkedValue`), else `true` for a checkbox field. A kind
 * that names a field of another type and no checked value draws no box.
 */
export function checkOf(node: Pick<NodeLike, "props">, nodeOf: NodeLookup): NodeCheck | null {
  for (const kind of kindsOf(node, nodeOf)) {
    const tag = nodeOf(kind);
    const field = refValuesOf(tag, SYSTEM_IDS.tagCheckField)[0];
    if (field === undefined) continue;
    const named = refValuesOf(tag, SYSTEM_IDS.tagCheckedValueField)[0];
    const checkbox = fieldTypeOf(nodeOf(field)?.props, nodeOf) === "checkbox";
    const value: PropValue | null =
      named !== undefined ? { t: "ref", v: named } : checkbox ? CHECKED : null;
    if (value === null) return null;
    const checked = (node.props[field] ?? []).some((held) => sameValue(held, value));
    return { field, value, checked };
  }
  return null;
}

/**
 * The `node.update` edit that leaves the box `box` `checked` (the other
 * state when absent): the checked value set; unchecked, `false` for a
 * checkbox, as its own toggle writes, and the checked value unset for any
 * other field.
 */
export function checkEdits(box: NodeCheck, checked = !box.checked): PropEdits {
  if (checked) return { setProps: [{ field: box.field, value: box.value }] };
  return sameValue(box.value, CHECKED)
    ? { setProps: [{ field: box.field, value: UNCHECKED }] }
    : { unsetProps: [{ field: box.field, value: box.value }] };
}
