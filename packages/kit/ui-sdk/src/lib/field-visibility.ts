import type { SchemaIndex } from "./schema";
import type { OutlineNode, PropValue, ResolvedProp } from "./types";
import { SYSTEM_IDS } from "./types";

/** Where field nodes are read: the schema, or any map of nodes by id. */
export interface FieldNodes {
  get(id: string): { readonly props: OutlineNode["props"] } | undefined;
}

/**
 * Whether a field's rows are left out unless a node asks for its debug
 * fields: its field node carries `sys.f.hidden` = true. The field node is
 * the one place that says it, a system field's as much as a person's
 * (DESIGN.md → Data model → field visibility), and every surface reads it
 * here: the field rows, a row's collapse default and a table's columns.
 * Whether a shown row may be written is the system-write rule's
 * (`isWritableField`), never this.
 */
export function isFieldHidden(fieldId: string, fields: FieldNodes): boolean {
  const hidden = fields.get(fieldId)?.props[SYSTEM_IDS.hiddenField]?.[0];
  return hidden?.t === "bool" && hidden.v;
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
}

export type VisibleProp = ResolvedProp & {
  /** Muted debug row: a field its node hides. */
  debug?: boolean;
  /** Template slot with no value yet (still editable). */
  empty?: boolean;
};

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
  const ids: string[] = [];
  for (const type of node.props[SYSTEM_IDS.typeField] ?? []) {
    if (type.t !== "ref" || typeof type.v !== "string") continue;
    for (const ref of schema.get(type.v)?.props[SYSTEM_IDS.fieldsField] ?? []) {
      if (ref.t !== "ref" || typeof ref.v !== "string") continue;
      if (!ids.includes(ref.v)) ids.push(ref.v);
    }
  }
  return ids;
}

/** Resolve node props for FieldRow display with visibility filtering. */
export function resolveVisibleProps(
  node: OutlineNode,
  schema: SchemaIndex,
  opts: ResolvePropsOptions = {},
): VisibleProp[] {
  const showAll = opts.showDebugFields ?? false;
  const out: VisibleProp[] = [];
  const seen = new Set<string>();

  for (const [fieldId, values] of Object.entries(node.props)) {
    const hiddenByDefault = isFieldHidden(fieldId, schema);
    if (!showAll && hiddenByDefault) continue;

    const fieldNode = schema.get(fieldId);
    seen.add(fieldId);
    out.push({
      fieldId,
      fieldName: fieldNode?.text ?? fieldId,
      values,
      debug: showAll && hiddenByDefault,
    });
  }

  // Surface inherited fields even when unset, so the node page is always the
  // configurator — no bespoke panel, and a tag's fields show up on its members
  // as soon as the tag declares them.
  for (const fieldId of templatedFieldIds(node, schema)) {
    if (seen.has(fieldId)) continue;
    if (!showAll && isFieldHidden(fieldId, schema)) continue;
    const fieldNode = schema.get(fieldId);
    out.push({
      fieldId,
      fieldName: fieldNode?.text ?? fieldId,
      values: [] as PropValue[],
      empty: true,
    });
    seen.add(fieldId);
  }

  return out;
}
