/**
 * How the canvas tells its scripts it lies (DESIGN-UI.md → Scripts): each
 * item's screen rectangle as the shown projection draws it
 * (`itemScreenRects`, the camera model's), which a script's drawing stands
 * on, and everywhere a press reaches something (`pressRegions`): every item
 * and the chrome its projection draws round it, every edge's line and
 * label, and the 3D gizmo's handles, from the meshes its picking hits —
 * which a script's drawing never lies over. Told again on every render —
 * whenever the page renders, and in 3D on every frame the camera moves,
 * which re-renders only this — as a way to work it out, which the layout
 * works out only while a script listens (`ViewLayout`).
 */
import { useEffect } from "react";
import type { CanvasDoc } from "@kb/canvas";
import type { ViewLayout } from "@kb/ui-sdk";
import type { SceneGizmo } from "./canvas-gizmo";
import { canvasProjection } from "./canvas-projections";
import { itemScreenRects, pressRegions } from "./canvas-visible";
import { useShownCamera, type ShownCameraProps } from "./use-shown-camera";

export function CanvasScriptLayout({
  doc,
  selected,
  gizmo,
  layout,
  ...camera
}: ShownCameraProps & {
  readonly doc: CanvasDoc;
  /** The selected items, whose handles a press reaches too. */
  readonly selected: ReadonlySet<string>;
  /** The scene's gizmo, which stands on the selection in 3D. */
  readonly gizmo: SceneGizmo;
  readonly layout: ViewLayout;
}) {
  // Read on every render: the camera, the page (the selection, the gizmo's mode) and the scene each move it.
  const { view, size } = useShownCamera(camera);
  const { in3d } = camera;
  const shown = canvasProjection(in3d ? "3d" : "2d");
  // Worked out when a script listens, not here: the gizmo's reach is read then, as it stands then.
  const told = () => {
    const own = in3d ? [gizmo.reach()].filter((reach) => reach !== null) : [];
    return {
      anchors: Object.fromEntries(itemScreenRects(doc.nodes, view, size)),
      interactive: pressRegions(doc, view, size, { chrome: shown.chrome, selected, own }),
    };
  };
  useEffect(() => layout.set(told));
  return null;
}
