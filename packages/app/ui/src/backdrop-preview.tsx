import { lazy, Suspense } from "react";
import type { PreviewSize } from "@kb/ui-sdk";
import { BackdropThemeTag } from "@/backdrop-theme-tag";

/** A backdrop's card: loaded where a gallery first draws one, not with the page. */
const BackdropCard = lazy(() => import("./backdrop-card"));

/**
 * The backdrop field's option preview, at either size (DESIGN-UI.md →
 * Option previews): the theme it belongs to as a chip, and the backdrop
 * itself, still, as a card.
 */
export function BackdropPreview({ id, size }: { readonly id: string; readonly size: PreviewSize }) {
  if (size === "chip") return <BackdropThemeTag id={id} />;
  // The tag is drawn here, not in the card's chunk, so no module straddles the lazy boundary.
  return (
    <span className="flex flex-col gap-1.5">
      <Suspense fallback={<span className="block h-24 rounded-md border border-border" />}>
        <BackdropCard id={id} />
      </Suspense>
      <BackdropThemeTag id={id} />
    </span>
  );
}
