import type { PropValue, RowCondition } from "@kb/ui-sdk";

/**
 * The condition a group's rows hold, which a row added to it holds too: its
 * field is its value; the "No <field>" group asks none.
 */
export function groupWhere(field: string | null, value: PropValue | null): RowCondition[] {
  if (field === null || value === null) return [];
  // A date value is a legacy text form (`migrateDateValues`), asked for as its text.
  const asked = value.t === "date" ? { t: "str" as const, v: value.v } : value;
  return [{ kind: "field-is", field, values: [asked] }];
}
