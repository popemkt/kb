import { useMemo, type RefObject } from "react";
import { posesAgree, type CanvasDoc, type CanvasProjectionKind } from "@kb/canvas";
import {
  SCREEN_APPLIED,
  screenRejected,
  type CanvasScreen,
  type CanvasViewTarget,
  type ScreenAck,
} from "@kb/contracts";
import {
  poseOfView,
  viewOfPan,
  viewOfTarget,
  type CanvasView,
  type CanvasViewportControls,
  type ViewSize,
} from "./canvas-camera";
import { visibleItemIds } from "./canvas-visible";
import type { CanvasSelection } from "./canvas-selection";
import { usePaneScreen, type PaneCommand, type PaneSelection } from "@kb/ui-sdk";
import { useStageSize } from "./use-stage-size";
import { useAtRest } from "./use-steady";

interface CanvasScreenInput {
  readonly canvasId: string;
  readonly doc: CanvasDoc;
  readonly pan: { readonly x: number; readonly y: number };
  readonly zoom: number;
  /** The projection showing, and in 3D the view it last came to rest at. */
  readonly shown: CanvasProjectionKind;
  readonly settled3d: CanvasView | null;
  readonly stage: RefObject<HTMLElement | null>;
  readonly selection: CanvasSelection;
  readonly setSelection: (selection: CanvasSelection) => void;
  /** The showing camera and its viewport, and how it is pointed: what a camera target moves. */
  readonly camera: () => { readonly view: CanvasView; readonly size: ViewSize };
  readonly viewport: CanvasViewportControls;
  /** Draw what a view sees, as a picture, the camera left where it is. */
  readonly capture: (view: CanvasView) => Promise<ScreenAck>;
}

/** How long the view and the document stand still before what the canvas shows is reported again. */
const REST_MS = 150;

/** What the screen reports the canvas showing: its document, through a view, on a stage of a size. */
interface Shown {
  readonly doc: CanvasDoc;
  readonly view: CanvasView;
  readonly width: number;
  readonly height: number;
}

const sameShown = (a: Shown, b: Shown) =>
  a.doc === b.doc && a.width === b.width && a.height === b.height && posesAgree(a.view, b.view);

/**
 * Report the canvas's part of the screen — the canvas node, its selected
 * items, the camera of the projection showing and the items it shows — and
 * carry out a `ui.select` of item ids, and a `ui.navigate`'s camera target
 * through the showing camera (`viewOfTarget`, then `show`). A canvas has no
 * focus to move. The camera and the items it shows are reported as they
 * come to rest, not on every frame of a gesture: in 3D as its camera
 * settles, in 2D once the view and the document have stood still for
 * `REST_MS` — so a pan or a drag works out what is visible once, after it.
 */
export function useCanvasScreen({
  canvasId,
  doc,
  pan,
  zoom,
  shown,
  settled3d,
  stage,
  selection,
  setSelection,
  camera,
  viewport,
  capture,
}: CanvasScreenInput): void {
  const { width, height } = useStageSize(stage);
  const size = { width, height };
  const view = shown === "3d" && settled3d !== null ? settled3d : viewOfPan(pan, zoom, size);
  const rested = useAtRest({ doc, view, width, height }, sameShown, REST_MS);
  const shows = useMemo(
    () => ({
      // The document's pose shape is the screen's: the bridge is checked here.
      pose: { ...poseOfView(rested.view), fov: rested.view.fov } satisfies CanvasScreen["pose"],
      visible: visibleItemIds(rested.doc.nodes, rested.view, rested),
    }),
    [rested],
  );
  const select = (command: PaneSelection): ScreenAck => {
    if (command.focus !== undefined) {
      return screenRejected("a canvas has no focus; select its items instead");
    }
    const ids = command.selection ?? [];
    const nodeIds = new Set(doc.nodes.map((item) => item.id));
    const edgeIds = new Set(doc.edges.map((edge) => edge.id));
    const unknown = ids.filter((id) => !nodeIds.has(id) && !edgeIds.has(id));
    if (unknown.length > 0) return screenRejected(`no item ${unknown.join(", ")} on this canvas`);
    setSelection({
      nodeIds: new Set(ids.filter((id) => nodeIds.has(id))),
      edgeIds: new Set(ids.filter((id) => edgeIds.has(id))),
    });
    return SCREEN_APPLIED;
  };
  /** The view a camera target names, from the showing camera; or why there is none. */
  const viewOf = (target: CanvasViewTarget | undefined): CanvasView | ScreenAck => {
    const now = camera();
    if (target === undefined) return now.view;
    const goal = viewOfTarget(target, doc.nodes, now.size, now.view);
    if (goal !== null) return goal;
    const missing = (target.items ?? []).filter((id) => !doc.nodes.some((n) => n.id === id));
    return screenRejected(
      missing.length > 0 ? `no item ${missing.join(", ")} on this canvas` : "nothing to look at",
    );
  };
  const carryOut = (command: PaneCommand): ScreenAck | Promise<ScreenAck> => {
    if (command.kind === "select") return select(command);
    const goal = viewOf(command.kind === "look" ? command.target : command.view);
    if ("outcome" in goal) return goal;
    // A look points the showing camera, as the view menu and present mode do; a capture leaves it.
    if (command.kind === "capture") return capture(goal);
    viewport.show(goal);
    return SCREEN_APPLIED;
  };
  usePaneScreen(
    {
      subject: canvasId,
      focused: null,
      selection: [...selection.nodeIds, ...selection.edgeIds],
      canvas: { projection: shown, ...shows },
    },
    carryOut,
  );
}
