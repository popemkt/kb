/**
 * The canvas's zoom (DESIGN-UI.md → Canvas → The context menu): the
 * header's zoom readout is a button, and it opens the zoom menu — in, out,
 * 100%, and framing all or the selection (`menuCommands`), tldraw's.
 */
import { useRef, useState, type RefObject } from "react";
import type { CanvasNode } from "@kb/canvas";
import type { CanvasIntent } from "./canvas-keymap";
import { CommandMenu } from "./canvas-menu";
import type { CanvasSelection } from "./canvas-selection";
import { menuCommands } from "./use-canvas-menu";

function ZoomMenu({
  trigger,
  selection,
  byId,
  onIntent,
  onClose,
}: {
  trigger: RefObject<HTMLButtonElement | null>;
  selection: CanvasSelection;
  byId: ReadonlyMap<string, CanvasNode>;
  onIntent: (intent: CanvasIntent) => void;
  onClose: () => void;
}) {
  return (
    <CommandMenu
      rows={menuCommands("zoom", selection, byId)}
      trigger={trigger}
      label="Zoom"
      testId="canvas-zoom-menu"
      className="absolute right-0 top-full z-40 mt-1 w-48"
      onIntent={onIntent}
      onClose={onClose}
    />
  );
}

export function CanvasZoomMenu({
  zoom,
  selection,
  byId,
  onIntent,
}: {
  zoom: number;
  selection: CanvasSelection;
  byId: ReadonlyMap<string, CanvasNode>;
  onIntent: (intent: CanvasIntent) => void;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <div className="relative">
      <button
        ref={trigger}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Zoom"
        className="rounded-md px-1.5 py-0.5 text-label tabular-nums text-foreground/45 hover:bg-foreground/5 hover:text-foreground/75"
        onClick={() => setOpen(!open)}
      >
        {Math.round(zoom * 100)}%
      </button>
      {open && (
        <ZoomMenu
          trigger={trigger}
          selection={selection}
          byId={byId}
          onIntent={onIntent}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}
