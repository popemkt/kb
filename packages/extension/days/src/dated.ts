/**
 * Which days a node is dated (DESIGN.md → Days, "Dated this day"): each
 * value it holds in a date-typed field, whatever the field and whichever
 * family made it. The field's type says a value is a date; a date value is
 * stored as its `YYYY-MM-DD` text, which is the day's key.
 */
import { fieldTypeOf, type NodeId, type NodeLike, type NodeOf } from "@kb/model";

/** One date a node holds: the field it is in and the day it names. */
export interface DatedValue {
  readonly field: NodeId;
  readonly day: string;
}

/** Every date `node` holds, in prop order, read through each field's type. */
export function datesOf(node: Pick<NodeLike, "props">, nodeOf: NodeOf): readonly DatedValue[] {
  const out: DatedValue[] = [];
  for (const [field, values] of Object.entries(node.props)) {
    if (fieldTypeOf(nodeOf(field)?.props, nodeOf) !== "date") continue;
    for (const value of values) {
      if (value.t === "str" && value.v !== "") out.push({ field, day: value.v });
    }
  }
  return out;
}

/** The nodes dated `day`, each with the field that dates it, in node order. */
export function datedOn(
  nodes: ReadonlyMap<NodeId, NodeLike>,
  day: string,
): readonly { readonly id: NodeId; readonly field: NodeId }[] {
  const nodeOf = (id: NodeId) => nodes.get(id);
  const out: { id: NodeId; field: NodeId }[] = [];
  for (const node of nodes.values()) {
    const dated = datesOf(node, nodeOf).find((value) => value.day === day);
    if (dated !== undefined) out.push({ id: node.id, field: dated.field });
  }
  return out;
}
