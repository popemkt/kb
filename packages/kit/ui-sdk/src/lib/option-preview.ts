/**
 * Option previews (DESIGN-UI.md → Option previews): a live sample of each
 * option of one declared kind, which the field editor draws. Any declared
 * kind may fill the slot (a design system with a swatch, a backdrop with a
 * thumbnail), and the field editor names none of them: it asks the point
 * for the field it draws.
 *
 * One preview per kind, drawn at a size: `chip`, the small sample before an
 * option's label at rest and in its picker, which every preview draws; and
 * `card`, a sample large enough to choose by, which a kind draws when its
 * options are best chosen by sight. A kind that draws `card` is how the
 * field editor knows to lay its field out as a gallery (DESIGN-UI.md →
 * Field values → option galleries), so no surface asks for one.
 */
import { createElement, type ComponentType, type ReactNode } from "react";
import { declaredIdOf, type DeclaredOptions, type NodeId } from "@kb/model";
import { Point } from "@kb/plugin";
import { useContributions } from "./plugins";

/** How large an option's preview is drawn. */
export type PreviewSize = "chip" | "card";

/**
 * The preview of `kind`'s options: `Preview` is handed an option's declared
 * id and a size among `sizes`, and draws nothing for an id it cannot show
 * (a thing nobody contributes now).
 */
export interface OptionPreview {
  readonly kind: DeclaredOptions;
  /** The sizes it draws: `chip` always, `card` where the kind is chosen by sight. */
  readonly sizes: readonly ["chip", ...PreviewSize[]];
  readonly Preview: ComponentType<{ readonly id: string; readonly size: PreviewSize }>;
}

export const OptionPreviewPoint = Point<OptionPreview>()("ui.option-previews");

/**
 * How each option of `fieldId` is previewed at `size`, by its option
 * node's id: null for a field no contribution previews at that size, and
 * nothing for an id outside the kind.
 */
export function useOptionPreview(
  fieldId: NodeId,
  size: PreviewSize = "chip",
): ((optionId: NodeId) => ReactNode) | null {
  const preview = useContributions(OptionPreviewPoint).find(
    ({ value }) => value.kind.field === fieldId,
  )?.value;
  if (preview === undefined || !preview.sizes.includes(size)) return null;
  const { kind, Preview } = preview;
  return (optionId) => {
    const id = declaredIdOf(kind, optionId);
    return id === undefined ? null : createElement(Preview, { id, size });
  };
}
