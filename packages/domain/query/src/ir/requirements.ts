/**
 * What a match requires (DESIGN.md → Query layer → What a match requires):
 * conditions read the other way, as what a new node must carry to hold them.
 * `node.add`'s `matching` and the page's "+ Add" (DESIGN-UI.md → Adding to a
 * frame) make a node that belongs where it was asked for with this, and the
 * query builder opens a query with `readQuery`, the one reading of a query's
 * stored text both start from.
 */
import {
  cardinalityOf,
  fieldTypeOf,
  SYSTEM_IDS,
  type NodeLike,
  type NodeId,
  type PropValue,
} from "@kb/model";
import {
  canonicalConditions,
  isRow,
  labelNumber,
  lift,
  type ConditionOf,
  type ConditionValue,
  type Lifted,
  type PlacementRow,
} from "./conditions.ts";
import { parseEdn } from "./parse.ts";

/**
 * The conditions stored text is, or why it is not any: parsed, then lifted
 * all or nothing (`lift`). Reading never writes.
 */
export function readQuery(edn: string): Lifted {
  try {
    return lift(parseEdn(edn));
  } catch (error) {
    return { lifted: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

/** What a new node carries to hold a list of conditions, and what it cannot be made to hold. */
export interface Requirements<X extends PlacementRow = never> {
  /** Tags it is given, by id. */
  readonly tags: readonly NodeId[];
  /** Values it is given, each a field's id and one value. */
  readonly props: readonly { readonly field: NodeId; readonly value: RequiredValue }[];
  /** The node it goes under, when the conditions name one. */
  readonly parent: NodeId | null;
  /** The conditions a write cannot choose for a person, left alone. */
  readonly unmet: readonly ConditionOf<X>[];
}

type NodeRead = (id: NodeId) => NodeLike | undefined;

/** A value a requirement writes: what a condition can ask for, never a legacy date value. */
type RequiredValue = Exclude<PropValue, { t: "date" }>;

/** A value a `field-is` asks for, as the field stores it; undefined when no one value is meant. */
function writtenValue(
  field: NodeId,
  value: ConditionValue,
  read: NodeRead,
): RequiredValue | undefined {
  if (value.t === "ref") return read(value.v) === undefined ? undefined : value;
  if (value.t !== "label") return value;
  const label = value.v;
  const fieldNode = read(field);
  const type = fieldTypeOf(fieldNode?.props, read);
  if (type === "ref") {
    const option = fieldNode?.children.find((id) => id === label || read(id)?.text === label);
    const id = option ?? (read(label) === undefined ? undefined : label);
    return id === undefined ? undefined : { t: "ref", v: id };
  }
  if (type === "number") {
    const n = labelNumber(label);
    return n === undefined ? undefined : { t: "num", v: n };
  }
  if (type === "checkbox") {
    return label === "true" || label === "false" ? { t: "bool", v: label === "true" } : undefined;
  }
  return { t: "str", v: label };
}

const sameValue = (a: RequiredValue, b: RequiredValue) => a.t === b.t && a.v === b.v;

/** A requirement as it is proposed, and the condition it holds. */
type Proposed<X extends PlacementRow> =
  | { readonly kind: "tag"; readonly id: NodeId; readonly from: ConditionOf<X> }
  | {
      readonly kind: "value";
      readonly field: NodeId;
      readonly value: RequiredValue;
      readonly from: ConditionOf<X>;
    }
  | { readonly kind: "parent"; readonly id: NodeId; readonly from: ConditionOf<X> };

/** The one requirement a top-level condition proposes, or null for one a write cannot choose. */
function propose<X extends PlacementRow>(c: ConditionOf<X>, read: NodeRead): Proposed<X> | null {
  if (!isRow(c)) return null;
  if (c.kind === "has-tag")
    return read(c.tag) === undefined ? null : { kind: "tag", id: c.tag, from: c };
  if (c.kind === "child-of") {
    return read(c.node) === undefined ? null : { kind: "parent", id: c.node, from: c };
  }
  if (c.kind !== "field-is" || c.values.length !== 1) return null;
  const [asked] = c.values;
  const value = asked === undefined ? undefined : writtenValue(c.field, asked, read);
  return value === undefined ? null : { kind: "value", field: c.field, value, from: c };
}

/**
 * What a new node must carry to hold `conditions`, read in their canonical
 * form: each top-level `has-tag`, `field-is` with one value and `child-of`
 * says one thing a write can do. Every other condition is unmet, and so are
 * rows that disagree: two parents, or two values of a field that holds one.
 */
export function requirementsOf<X extends PlacementRow = never>(
  conditions: readonly ConditionOf<X>[],
  read: NodeRead,
): Requirements<X> {
  const unmet: ConditionOf<X>[] = [];
  const proposed: Proposed<X>[] = [];
  for (const c of canonicalConditions(conditions)) {
    const one = propose(c, read);
    if (one === null) unmet.push(c);
    else proposed.push(one);
  }
  const parents = proposed.filter((p) => p.kind === "parent");
  const disagree = (p: Proposed<X>): boolean => {
    if (p.kind === "parent") return parents.some((q) => q.id !== p.id);
    if (p.kind !== "value") return false;
    if (cardinalityOf(read(p.field)?.props, read) !== "one") return false;
    return proposed.some(
      (q) => q.kind === "value" && q.field === p.field && !sameValue(q.value, p.value),
    );
  };
  const kept: Proposed<X>[] = [];
  for (const p of proposed) {
    if (disagree(p)) unmet.push(p.from);
    else kept.push(p);
  }
  const tags = [...new Set(kept.flatMap((p) => (p.kind === "tag" ? [p.id] : [])))];
  const props: { field: NodeId; value: RequiredValue }[] = [];
  for (const p of kept) {
    if (p.kind !== "value") continue;
    // A tag the node is given already holds `field-is` on its type.
    if (p.field === SYSTEM_IDS.typeField && p.value.t === "ref" && tags.includes(p.value.v)) {
      continue;
    }
    if (!props.some((q) => q.field === p.field && sameValue(q.value, p.value))) {
      props.push({ field: p.field, value: p.value });
    }
  }
  const parent = kept.find((p) => p.kind === "parent");
  return { tags, props, parent: parent?.kind === "parent" ? parent.id : null, unmet };
}
