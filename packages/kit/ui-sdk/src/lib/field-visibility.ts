import { fieldShowOf, pinnedFirst, templateFieldsOf, typeRefsOf } from "@kb/model";
import { nameIn } from "./contextual-ref";
import type { SchemaIndex } from "./schema";
import type { OutlineNode, PropValue, ResolvedProp } from "./types";

/** Where field nodes are read: the schema, or any map of nodes by id. */
export interface FieldNodes {
  get(id: string): FieldNode | undefined;
}

/** What visibility reads of a field node: its props. */
type FieldNode = { readonly props: OutlineNode["props"] };

/**
 * Whether a field's rows are left out unless a node asks for its debug
 * fields: its field node's show is never. The field node is the one place
 * that says it, a system field's as much as a person's (DESIGN.md → Data
 * model → field display, read by `fieldShowOf`), and every surface reads it
 * here: the field rows, a row's collapse default and a table's columns.
 * Whether a shown row may be written is the system-write rule's
 * (`isWritableField`), never this.
 */
export function isFieldHidden(fieldId: string, fields: FieldNodes): boolean {
  return fieldShowOf(fields.get(fieldId)?.props) === "never";
}

export interface ResolvePropsOptions {
  /**
   * Reveal this node's hidden fields with muted styling.
   *
   * Per node, per call — the caller reads it from
   * `stores/debug-fields.store` for the node it is rendering. It was once a
   * device-wide pref, which is why the option is worth naming precisely.
   */
  showDebugFields?: boolean;
  /**
   * Fields drawn though their field node hides them, as any other field is:
   * the ones the node's display asks for (the outline's "Show properties"
   * reveals the fields of the tag that opens the node in its view, which
   * that view draws instead).
   */
  revealed?: ReadonlySet<string> | undefined;
}

export type VisibleProp = ResolvedProp & {
  /** Muted debug row: a field its node hides. */
  debug?: boolean;
  /** Template slot with no value yet (still editable). */
  empty?: boolean;
  /** Where the node draws the field (`FieldPlacement`). */
  placement: FieldPlacement;
};

/**
 * Where a node draws a field it has (DESIGN-UI.md → Field values → hidden
 * fields chips): a row of its own, a chip in the node's line of hidden
 * fields, or tucked behind that line's "…".
 */
type FieldPlacement = "row" | "chip" | "tucked";

/**
 * Field ids this node inherits, in declaration order.
 *
 * Everything in the node's kind slot contributes its own `sys.f.fields`
 * template: `sys.tag` gives a tag node color and hidden, `sys.field` gives a
 * field node its type and ref constraints, and a user supertag gives its
 * members whatever fields were added to it. That last case is the one this
 * replaces — the old rule consulted only `sys.tag`'s template and only for tag
 * schema, so fields added to a supertag stayed invisible on its members until
 * somebody set a value, which made adding fields to a tag look like it did
 * nothing.
 */
function templatedFieldIds(node: OutlineNode, schema: SchemaIndex): string[] {
  return templateFieldsOf(typeRefsOf(node), (id) => schema.get(id));
}

const NONE: ReadonlySet<string> = new Set();

/**
 * Where each show places a field on a node, filled or not (DESIGN.md → Data
 * model → field display). Only asked of a field the node draws, so a field
 * shown never, revealed or drawn for debug, is a row.
 */
const PLACEMENT_BY_SHOW: Readonly<
  Record<ReturnType<typeof fieldShowOf>, (filled: boolean) => FieldPlacement>
> = {
  always: () => "row",
  filled: (filled) => (filled ? "row" : "chip"),
  hidden: () => "chip",
  tucked: () => "tucked",
  never: () => "row",
};

/**
 * Resolve node props for FieldRow display with visibility filtering: the
 * fields drawn, pinned ones first (`pinnedFirst`), each with its
 * `placement`.
 */
export function resolveVisibleProps(
  node: OutlineNode,
  schema: SchemaIndex,
  opts: ResolvePropsOptions = {},
): VisibleProp[] {
  const showAll = opts.showDebugFields ?? false;
  const revealed = opts.revealed ?? NONE;
  // Debug fields draw every field as a row, as a node's display draws those it reveals.
  const place = (fieldId: string, fieldNode: FieldNode | undefined, filled: boolean) =>
    showAll || revealed.has(fieldId)
      ? "row"
      : PLACEMENT_BY_SHOW[fieldShowOf(fieldNode?.props)](filled);
  // Hidden from this node's rows: its field node hides it, and its display does not reveal it.
  const hides = (fieldId: string) => !revealed.has(fieldId) && isFieldHidden(fieldId, schema);
  const out: VisibleProp[] = [];
  const seen = new Set<string>();

  for (const [fieldId, values] of Object.entries(node.props)) {
    const hiddenByDefault = hides(fieldId);
    if (!showAll && hiddenByDefault) continue;

    const fieldNode = schema.get(fieldId);
    seen.add(fieldId);
    out.push({
      fieldId,
      fieldName: nameIn(schema, fieldId) || fieldId,
      values,
      debug: showAll && hiddenByDefault,
      placement: place(fieldId, fieldNode, true),
    });
  }

  // Surface inherited fields even when unset, so the node page is always the
  // configurator — no bespoke panel, and a tag's fields show up on its members
  // as soon as the tag declares them.
  for (const fieldId of templatedFieldIds(node, schema)) {
    if (seen.has(fieldId)) continue;
    if (!showAll && hides(fieldId)) continue;
    const fieldNode = schema.get(fieldId);
    out.push({
      fieldId,
      fieldName: nameIn(schema, fieldId) || fieldId,
      values: [] as PropValue[],
      empty: true,
      placement: place(fieldId, fieldNode, false),
    });
    seen.add(fieldId);
  }

  return pinnedFirst(
    out,
    (prop) => prop.fieldId,
    (id) => schema.get(id),
  );
}
