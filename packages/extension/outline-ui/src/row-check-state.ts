/**
 * A row's box as its tag says (DESIGN-UI.md → A tag's box): read from the
 * field the box is tied to (`checkOf`), so the box holds no state of its
 * own, and the ink the row's text takes once it is checked.
 */
import { checkOf } from "@kb/model";
import { textOr, type OutlineNode, type SchemaIndex } from "@kb/ui-sdk";

/**
 * The box of `shown`, the node a row draws, named by its field; null when
 * no tag of it names one.
 */
// GAP [[01M7CZXE92JQP5495R9XJPMM8N]] a checklist row shows no box until a tag ties one to its done field
export function rowCheckOf(shown: OutlineNode, schema: SchemaIndex) {
  const check = checkOf(shown, (id) => schema.get(id));
  if (check === null) return null;
  return { checked: check.checked, label: textOr(schema.get(check.field)?.text, check.field) };
}

/**
 * The ink of a checked row's text: the muted secondary text, so it reads as
 * done. A colour only, so nothing moves.
 */
export function checkedTextClass(shown: OutlineNode, schema: SchemaIndex): string | undefined {
  return rowCheckOf(shown, schema)?.checked === true ? "text-muted-foreground" : undefined;
}
