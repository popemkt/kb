import type { PreviewSize } from "@kb/ui-sdk";
import { BackdropCard } from "@kb/ui-sdk";
import { BackdropThemeTag } from "@/backdrop-theme-tag";

/**
 * The backdrop field's option preview, at either size (DESIGN-UI.md →
 * Option previews): the theme it belongs to as a chip, and the backdrop
 * itself, still, as a card (`BackdropCard`, the kit's, which every gallery
 * of backdrops draws).
 */
export function BackdropPreview({ id, size }: { readonly id: string; readonly size: PreviewSize }) {
  if (size === "chip") return <BackdropThemeTag id={id} />;
  return (
    <span className="flex flex-col gap-1.5">
      <BackdropCard id={id} />
      <BackdropThemeTag id={id} />
    </span>
  );
}
