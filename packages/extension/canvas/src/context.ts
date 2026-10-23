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

/** The namespace the family's actions are in, which its references share (`ext.canvas.open`). */
const NAMESPACE = "ext.canvas";

export const CANVAS_CONTEXT: Readonly<Record<string, ContextReference>> = {
  [`${NAMESPACE}.open`]: {
    description: "the canvas the pane shows",
    resolve: (pane) => (onCanvas(pane) ? pane.view?.subject : undefined),
  },
  [`${NAMESPACE}.selection`]: {
    description: "the canvas items selected on the pane",
    resolve: (pane) => (onCanvas(pane) && pane.selection.length > 0 ? pane.selection : undefined),
  },
};
