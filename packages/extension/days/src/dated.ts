/**
 * Which days a node is dated (DESIGN.md → Days, "Dated this day"): each
 * value it holds in a date-typed field, whatever the field and whichever
 * family made it. The field's type says a value is a date; a date value is
 * stored as its `YYYY-MM-DD` text, which is the day's key.
 */
import {
  fieldTypeOf,
  type FieldType,
  type NodeId,
  type NodeLike,
  type NodeOf,
  type PropValue,
} from "@kb/model";
import { periodNodeId } from "./ids.ts";

/** One date a node holds: the field it is in and the day it names. */
export interface DatedValue {
  readonly field: NodeId;
  readonly day: string;
}

/** The day `value` names, held in a field of type `type`: a date field's non-empty value, else none. */
export function dayOfValue(value: PropValue, type: FieldType): string | null {
  return type === "date" && value.t === "str" && value.v !== "" ? value.v : null;
}

/** Every date `node` holds, in prop order, read through each field's type. */
export function datesOf(node: Pick<NodeLike, "props">, nodeOf: NodeOf): readonly DatedValue[] {
  const out: DatedValue[] = [];
  for (const [field, values] of Object.entries(node.props)) {
    const type = fieldTypeOf(nodeOf(field)?.props, nodeOf);
    for (const value of values) {
      const day = dayOfValue(value, type);
      if (day !== null) out.push({ field, day });
    }
  }
  return out;
}

/**
 * What a date value references (DESIGN.md → Days, "Date fields link to
 * days"): its day's node, by its derived id, mentioned once it exists. The
 * family declares it as a carrier over every field (`refCarriers` in
 * `./extension.ts`), so the day's References and `kb backlinks` list what
 * is dated it.
 */
// GAP [[01M73N2FPM7GGCX6H62V6PE8JG]] a day under another id than days.<date> is not mentioned
export function dateDayReferences(value: PropValue, field: { readonly type: FieldType }): NodeId[] {
  const day = dayOfValue(value, field.type);
  return day === null ? [] : [periodNodeId(day)];
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
