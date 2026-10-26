import {
  BACKDROP_OPTIONS,
  DESIGN_SYSTEM_OPTIONS,
  SYSTEM_IDS,
  backdropOptionId,
  declaredIdOf,
  designSystemOptionId,
  firstRef,
} from "@kb/model";
import { useNode, useShownDesignSystem } from "@kb/ui-sdk";
import { DesignSystemSwatch } from "@/design-system-swatch";

/**
 * A backdrop option's tag: the swatch of the theme it belongs to (its
 * option node's design-system field), and `default` on the one the shown
 * theme pairs with (that theme's option node's backdrop field). Both are
 * read from the graph, so a family that declares a backdrop of its theme's
 * is tagged with no code here. Nothing for a backdrop of no theme. It is
 * the backdrop field's option preview (DESIGN-UI.md → Option previews).
 */
export function BackdropThemeTag({ id }: { readonly id: string }) {
  const option = useNode(backdropOptionId(id));
  const shown = useShownDesignSystem();
  const pairing = useNode(shown === null ? undefined : designSystemOptionId(shown.key.id));
  const theme = declaredIdOf(
    DESIGN_SYSTEM_OPTIONS,
    firstRef(SYSTEM_IDS.designSystemField)(option?.props ?? {}),
  );
  const paired =
    declaredIdOf(BACKDROP_OPTIONS, firstRef(SYSTEM_IDS.backdropField)(pairing?.props ?? {})) === id;
  if (theme === undefined && !paired) return null;
  return (
    <span data-backdrop-theme={theme} className="flex shrink-0 items-center gap-1">
      {theme === undefined ? null : <DesignSystemSwatch id={theme} />}
      {paired ? <span className="kb-label text-caption text-muted-foreground">default</span> : null}
    </span>
  );
}
