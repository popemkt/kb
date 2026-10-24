/**
 * The mark an item that carries a link wears (DESIGN-UI.md → Canvas → Item
 * links): a small link glyph under its bottom right corner as the shown
 * projection draws it (`linkMarks`), in either projection, as
 * tldraw's shape link button is. It says where the link leads
 * (`leadsTo`), and a click follows it, as ⌘↵ does.
 */
import { LinkSimpleIcon } from "@phosphor-icons/react";
import type { CanvasDoc, CanvasItemLink, CanvasWorld } from "@kb/canvas";
import type { CanvasView } from "./canvas-camera";
import type { CanvasCameraRig } from "./canvas-camera-rig";
import { linkMarks } from "./canvas-visible";
import { leadsTo } from "./item-link-text";
import { useShownView } from "./use-shown-view";

/** How far under its item's corner the mark hangs, clear of a selected item's handle. */
const MARK_DROP = 6;

export function CanvasLinkMarks({
  rig,
  in3d,
  flatView,
  width,
  height,
  doc,
  world,
  onFollow,
}: {
  readonly rig: CanvasCameraRig;
  /** The 3D scene is the one showing (otherwise the view is `flatView`). */
  readonly in3d: boolean;
  readonly flatView: CanvasView;
  readonly width: number;
  readonly height: number;
  readonly doc: CanvasDoc;
  readonly world: CanvasWorld;
  readonly onFollow: (link: CanvasItemLink) => void;
}) {
  const view = useShownView(rig, in3d, flatView);
  return (
    <div className="pointer-events-none absolute inset-0 z-20 overflow-hidden">
      {linkMarks(doc, view, { width, height }).map(({ item, link, at }) => {
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
}
