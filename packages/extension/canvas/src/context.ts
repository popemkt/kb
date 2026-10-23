/**
 * The canvas family's context references (DESIGN.md → Action registry →
 * What a session fills): what "this canvas" and "the selected items" are on
 * a pane. Only a pane whose view is a canvas holds either, so a selection is
 * read as a canvas's item ids only where it is one.
 */
import type { ContextReference, PaneScreen } from "@kb/contracts";
import { CanvasView } from "./view.ts";

function onCanvas(pane: PaneScreen): boolean {
  return pane.view?.key === CanvasView.id;
}

/** The canvas a canvas pane shows: in the namespace the family's actions are in. */
export const CANVAS_OPEN = "ext.canvas.open";
/** The items selected on a canvas pane. */
export const CANVAS_SELECTION = "ext.canvas.selection";

export const CANVAS_CONTEXT: Readonly<Record<string, ContextReference>> = {
  [CANVAS_OPEN]: {
    description: "the canvas the pane shows",
    resolve: (pane) => (onCanvas(pane) ? pane.view?.subject : undefined),
  },
  [CANVAS_SELECTION]: {
    description: "the canvas items selected on the pane",
    resolve: (pane) => (onCanvas(pane) && pane.selection.length > 0 ? pane.selection : undefined),
  },
};
