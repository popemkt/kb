/**
 * Which day a value dates (DESIGN.md → Days, "A node is dated a day by any
 * date field"): a value in a date-typed field, whatever the field and
 * whichever family made it. The field's type says a value is a date; a
 * date value is stored as its `YYYY-MM-DD` text, which is the day's key.
 */
import type { FieldType, PropValue } from "@kb/model";
import type { KeyRef } from "@kb/query";
import { DAYS_IDS } from "./ids.ts";

/** The day `value` names, held in a field of type `type`: a date field's non-empty value, else none. */
function dayOfValue(value: PropValue, type: FieldType): string | null {
  return type === "date" && value.t === "str" && value.v !== "" ? value.v : null;
}

/**
 * What a date value references (DESIGN.md → Days, "Date fields link to
 * days"): the day whose key is that date, by key, so the day is found under
 * whatever id it was made with, once it exists. The family declares it as a
 * carrier over every field (`refCarriers` in `./extension.ts`), so the
 * day's References and `kb backlinks` list what is dated it.
 */
export function dateDayReferences(value: PropValue, field: { readonly type: FieldType }): KeyRef[] {
  const day = dayOfValue(value, field.type);
  return day === null ? [] : [{ field: DAYS_IDS.keyField, value: day }];
}
