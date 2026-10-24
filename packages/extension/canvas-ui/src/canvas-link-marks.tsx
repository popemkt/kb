/**
 * The mark an item that carries a link wears (DESIGN-UI.md → Canvas → Item
 * links): a small link glyph under its bottom right corner as the shown
 * projection draws it (`linkMarks`), in either projection, as
 * tldraw's shape link button is. It says where the link leads
 * (`leadsTo`), and a click follows it, as ⌘↵ does. Drawn again only when
 * the document, the world or the camera moves (DESIGN-UI.md → Canvas →
 * Update cost), never because the page drew.
 */
import { memo } from "react";
import { LinkSimpleIcon } from "@phosphor-icons/react";
import type { CanvasDoc, CanvasItemLink, CanvasWorld } from "@kb/canvas";
import { linkMarks } from "./canvas-visible";
import { leadsTo } from "./item-link-text";
import { useShownCamera, type ShownCameraProps } from "./use-shown-camera";

/** How far under its item's corner the mark hangs, clear of a selected item's handle. */
const MARK_DROP = 6;

export const CanvasLinkMarks = memo(function CanvasLinkMarks({
  doc,
  world,
  onFollow,
  ...camera
}: ShownCameraProps & {
  readonly doc: CanvasDoc;
  readonly world: CanvasWorld;
  /** Go where a link leads: a handler that lasts the page's life. */
  readonly onFollow: (link: CanvasItemLink) => void;
}) {
  const { view, size } = useShownCamera(camera);
  return (
    <div className="pointer-events-none absolute inset-0 z-20 overflow-hidden">
      {linkMarks(doc, view, size).map(({ item, link, at }) => {
        const says = leadsTo(link, world);
        return (
          <button
            key={item}
            type="button"
            data-link-mark={item}
            aria-label={says}
            title={`${says} (⌘↵)`}
            className="pointer-events-auto absolute flex h-5 w-5 -translate-x-full items-center justify-center rounded-md border border-foreground/10 bg-popover text-foreground/60 shadow-floating hover:text-primary"
            style={{ left: at.x, top: at.y + MARK_DROP }}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => onFollow(link)}
          >
            <LinkSimpleIcon size={12} />
          </button>
        );
      })}
    </div>
  );
});
