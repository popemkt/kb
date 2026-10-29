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
  return (
    <Suspense fallback={null}>
      <BackdropCard id={id} />
    </Suspense>
  );
}
