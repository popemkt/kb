/**
 * The repeat type's row of data (DESIGN-UI.md → Field values → Value
 * kinds): a rule is text, so its editor's text is the rule and any text
 * reads back as one, through the parser the store's write check agrees
 * with. Its surface is `repeat-value.tsx`.
 */
import { parseTypedValue } from "@kb/model";
import type { ValueKindSpec } from "@kb/ui-sdk";

export const REPEAT_SPEC: ValueKindSpec = {
  editor: "caret",
  text: (value) => (value.t === "str" ? value.v : ""),
  parse: (text) => parseTypedValue(text, "text"),
  isBlank: (value) => value.t !== "str" || value.v === "",
  layout: "stack",
  follow: () => null,
};
