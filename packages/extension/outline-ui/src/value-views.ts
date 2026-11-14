import {
  CalendarBlankIcon,
  ClockIcon,
  HashIcon,
  LinkSimpleIcon,
  PaletteIcon,
  TextTIcon,
  CheckSquareIcon,
  KeyIcon,
} from "@phosphor-icons/react";
import type { FieldTypeKind, ValueView } from "@kb/ui-sdk";
import { FIELD_TYPE_OPTION_IDS, FIELD_TYPES, type FieldType } from "@kb/model";
import {
  CheckboxSurface,
  ColorSurface,
  DateSurface,
  NumberSurface,
  OptionSurface,
  RefSurface,
  SecretSurface,
  TextSurface,
  UrlSurface,
} from "./field-value.tsx";
import { VALUE_KINDS, valueKindOf, type ValueKind } from "./value-kind";
import type { Icon } from "@phosphor-icons/react";

/**
 * The view registry: one row per value kind, keyed by the same union as the
 * kind table (`VALUE_KINDS`). A new kind is a row here and a row there.
 *
 * `url` shares the text glyph, as it always has. That is a cell rather than a
 * fall-through, so giving it its own icon is a one-word change.
 */
export const VALUE_VIEWS: Readonly<Record<ValueKind, ValueView>> = {
  text: { icon: TextTIcon, Surface: TextSurface },
  url: { icon: TextTIcon, Surface: UrlSurface },
  number: { icon: HashIcon, Surface: NumberSurface },
  time: { icon: ClockIcon, Surface: TextSurface },
  date: { icon: CalendarBlankIcon, Surface: DateSurface },
  checkbox: { icon: CheckSquareIcon, Surface: CheckboxSurface },
  ref: { icon: LinkSimpleIcon, Surface: RefSurface },
  option: { icon: LinkSimpleIcon, Surface: OptionSurface },
  color: { icon: PaletteIcon, Surface: ColorSurface },
  secret: { icon: KeyIcon, Surface: SecretSurface },
};

/**
 * The outline's kinds of the built-in types, each for its type's option
 * node: what it contributes to `ui.value-kinds` (`outlineValueKindsPlugin`).
 */
export const BUILT_IN_KINDS: readonly FieldTypeKind[] = FIELD_TYPES.map((type) => ({
  type: FIELD_TYPE_OPTION_IDS[type],
  spec: VALUE_KINDS[type],
  ...VALUE_VIEWS[type],
}));

/**
 * The glyph the outline's own kind of `fieldType` wears, for a field named
 * by its type rather than resolved through `ui.value-kinds` (`useSlotKind`).
 */
export function fieldGlyphOf(fieldType: FieldType, fieldId?: string): Icon {
  return VALUE_VIEWS[valueKindOf(fieldType, fieldId)].icon;
}
