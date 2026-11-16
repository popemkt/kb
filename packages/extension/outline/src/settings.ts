/**
 * The outline family's settings, read off its extension node
 * (`sys.extension.outline`), where they are written like any field.
 */
import { firstBool, refValuesOf, type NodeLike, type PropValue, type RefForm } from "@kb/model";
import { EXPORT_DEFAULTS, OUTLINE_FORMAT_IDS, type ExportOptions } from "@kb/outline-paste";
import { copyFormatOption, copyIndentOption, copyRefsOption, OUTLINE_IDS } from "./ids.ts";

/**
 * Whether a collapsed parent's bullet shows how many children it has
 * (DESIGN-UI.md → "A collapsed parent's halo says it is closed; its count
 * is a setting"); off when the node says nothing.
 */
export function showsChildCounts(family: Pick<NodeLike, "props"> | undefined): boolean {
  return family !== undefined && firstBool(OUTLINE_IDS.childCountsField)(family.props) === true;
}

const REF_FORMS: readonly RefForm[] = ["label", "link", "id"];
const INDENTS: readonly ExportOptions["indent"][] = ["spaces", "tabs"];

/** The value among `values` whose option the family's `field` names, else `fallback`. */
function chosen<T>(
  family: Pick<NodeLike, "props"> | undefined,
  field: string,
  values: readonly T[],
  optionOf: (value: T) => string,
  fallback: T,
): T {
  const [option] = refValuesOf(family, field);
  return values.find((value) => optionOf(value) === option) ?? fallback;
}

/**
 * What Copy as… opens on (DESIGN-UI.md → Outline editor, "Copy, cut and
 * Copy as…"): the choice the family's node holds, each setting it leaves
 * unset, or sets to an option it does not know, read as `EXPORT_DEFAULTS`.
 */
export function copyChoiceOf(family: Pick<NodeLike, "props"> | undefined): ExportOptions {
  const { copy } = OUTLINE_IDS;
  const checked = (field: string, fallback: boolean) =>
    (family === undefined ? undefined : firstBool(field)(family.props)) ?? fallback;
  return {
    format: chosen(
      family,
      copy.formatField,
      OUTLINE_FORMAT_IDS,
      copyFormatOption,
      EXPORT_DEFAULTS.format,
    ),
    refs: chosen(family, copy.refsField, REF_FORMS, copyRefsOption, EXPORT_DEFAULTS.refs),
    indent: chosen(family, copy.indentField, INDENTS, copyIndentOption, EXPORT_DEFAULTS.indent),
    children: checked(copy.childrenField, EXPORT_DEFAULTS.children),
    fieldsAndTags: checked(copy.fieldsAndTagsField, EXPORT_DEFAULTS.fieldsAndTags),
  };
}

/** Each copy setting's value as `choice` writes it, by field. */
export function copyChoiceValues(choice: ExportOptions): Readonly<Record<string, PropValue>> {
  const { copy } = OUTLINE_IDS;
  return {
    [copy.formatField]: { t: "ref", v: copyFormatOption(choice.format) },
    [copy.refsField]: { t: "ref", v: copyRefsOption(choice.refs) },
    [copy.indentField]: { t: "ref", v: copyIndentOption(choice.indent) },
    [copy.childrenField]: { t: "bool", v: choice.children },
    [copy.fieldsAndTagsField]: { t: "bool", v: choice.fieldsAndTags },
  };
}
