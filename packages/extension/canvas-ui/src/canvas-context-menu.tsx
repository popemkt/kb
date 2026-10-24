/**
 * The canvas's context menu (DESIGN-UI.md → Canvas → The context menu):
 * a right-click on the 2D stage selects what it lands on, as tldraw's does
 * (`selectForMenu`, `useCanvasContextMenu`), and opens there, kept inside
 * the stage, the menu of what is done to the selection, or to the canvas
 * when nothing is selected (`menuCommands`).
 */
import type { CanvasNode } from "@kb/canvas";
import type { CanvasIntent } from "./canvas-keymap";
import { CommandMenu } from "./canvas-menu";
import { selectionEmpty, type CanvasSelection } from "./canvas-selection";
import { menuCommands } from "./use-canvas-menu";

interface Spot {
  readonly x: number;
  readonly y: number;
}

interface ContextMenuProps {
  selection: CanvasSelection;
  byId: ReadonlyMap<string, CanvasNode>;
  onIntent: (intent: CanvasIntent) => void;
  onClose: () => void;
}

/** The menu open at `at` over the stage (`useCanvasContextMenu`), or nothing while it is shut. */
export function CanvasContextMenu({ at, ...props }: ContextMenuProps & { at: Spot | null }) {
  if (at === null) return null;
  return <OpenMenu at={at} {...props} />;
}

function OpenMenu({ at, selection, byId, onIntent, onClose }: ContextMenuProps & { at: Spot }) {
  const menu = selectionEmpty(selection) ? "canvas" : "selection";
  return (
    <CommandMenu
      rows={menuCommands(menu, selection, byId)}
      at={at}
      trigger={null}
      label="Canvas"
      testId="canvas-context-menu"
      // Over the selection bar and the dock, which a menu opened low or right would run under.
      className="absolute z-40 w-52"
      onIntent={onIntent}
      onClose={onClose}
    />
  );
}
