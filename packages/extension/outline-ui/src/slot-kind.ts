/**
 * The kind a field's values sit in, resolved once for every surface that
 * draws a field: the slot (its spec and surface), the stack (whether adding
 * is a picker), and the field row (its glyph).
 *
 * A field may name its own kind (`sys.f.color`), and a ref field whose node
 * parents its values holds options; those are the outline's own, about the
 * field. Every other field's values are of its type's kind, contributed to
 * `ui.value-kinds` for the type's option node — the outline contributes the
 * built-in eight (`outlineValueKindsPlugin`), and a family its own types'.
 */
import { useMemo } from "react";
import {
  declaredIdOf,
  fieldTypeOptionOf,
  FIELD_TYPE_OPTIONS,
  type NodeId,
  FIELD_TYPE_OPTION_IDS,
  type FieldType,
} from "@kb/model";
import { definePlugin } from "@kb/plugin";
import { Effect } from "effect";
import {
  useContributions,
  ValueKindPoint,
  type FieldTypeKind,
  type SchemaIndex,
  type ValueKindSpec,
  type ValueView,
} from "@kb/ui-sdk";
import { VALUE_KINDS, valueKindOf } from "./value-kind";
import { BUILT_IN_KINDS, VALUE_VIEWS } from "./value-views";

/** A field's kind, whole: its name (`data-value-slot`), its row of data and its view. */
export interface SlotKind extends ValueView {
  readonly name: string;
  readonly spec: ValueKindSpec;
}

/** The kinds contributed for field types, by option node. */
export type KindsByType = (type: NodeId) => FieldTypeKind | undefined;

/**
 * The kind the values of `fieldId`, a field of `type`, sit in, among
 * `kinds`: the kind contributed for the option its node names, else the
 * one for `type`'s.
 */
export function slotKindOf(
  kinds: KindsByType,
  type: FieldType,
  fieldId: string,
  schema: SchemaIndex,
): SlotKind {
  const node = schema.get(fieldId);
  const own = valueKindOf(type, fieldId, node);
  if (own === "color" || own === "option") {
    return { name: own, spec: VALUE_KINDS[own], ...VALUE_VIEWS[own] };
  }
  const option = fieldTypeOptionOf(node?.props);
  const kind = (option === null ? undefined : kinds(option)) ?? kinds(FIELD_TYPE_OPTION_IDS[type]);
  if (kind === undefined) throw new Error(`no value kind is contributed for ${type} fields`);
  return { ...kind, name: declaredIdOf(FIELD_TYPE_OPTIONS, kind.type) ?? kind.type };
}

/** The kind the values of `fieldId`, of `type`, sit in, as the page's contributions stand now. */
export function useSlotKind(type: FieldType, fieldId: string, schema: SchemaIndex): SlotKind {
  const entries = useContributions(ValueKindPoint);
  const byType = useMemo(
    () => new Map(entries.map(({ value }) => [value.type, value] as const)),
    [entries],
  );
  return slotKindOf((option) => byType.get(option), type, fieldId, schema);
}

/** The outline's kinds of the built-in types, as contributions to `ui.value-kinds`. */
export const outlineValueKindsPlugin = definePlugin({
  name: "outline-value-kinds",
  apply: (ctx) =>
    Effect.all(
      BUILT_IN_KINDS.map((kind) =>
        ctx.contribute(ValueKindPoint, {
          id: declaredIdOf(FIELD_TYPE_OPTIONS, kind.type) ?? kind.type,
          value: kind,
        }),
      ),
      { discard: true },
    ),
});
