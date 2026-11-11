/**
 * Which day a value dates (DESIGN.md → Days, "A node is dated a day by any
 * date field"): a value in a date-typed field, whatever the field and
 * whichever family made it. The field's type says a value is a date; a
 * date value is stored as its `YYYY-MM-DD` text, which is the day's key.
 */
import type { FieldType, NodeId, PropValue } from "@kb/model";
import { periodNodeId } from "./ids.ts";

/** The day `value` names, held in a field of type `type`: a date field's non-empty value, else none. */
function dayOfValue(value: PropValue, type: FieldType): string | null {
  return type === "date" && value.t === "str" && value.v !== "" ? value.v : null;
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
