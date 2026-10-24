import {
  GRID_STEP,
  type CanvasDoc,
  type CanvasEdge,
  type CanvasNode,
  type CanvasSide,
} from "@kb/canvas";
import { useDeferredValue, useRef } from "react";
import { CanvasCardLayer } from "./canvas-card-layer";
import { CanvasEdgeLayer, GhostEdgePath } from "./canvas-edge-layer";
import { viewOfPan } from "./canvas-camera";
import { floorWindow, type FloorWindow } from "./canvas-visible";
import { useStableActions } from "./use-stable-actions";
import { useStageSize } from "./use-stage-size";
import { useSteady } from "./use-steady";
import type { CanvasSelection } from "./canvas-selection";
import type { PointerResult, PointerState, ResizeCorner } from "./canvas-pointer";
import type { ToolState } from "./canvas-tool";
import { cn, type OutlineNode } from "@kb/ui-sdk";

interface CanvasStageProps {
  doc: CanvasDoc;
  nodes: ReadonlyMap<string, OutlineNode>;
  byId: Map<string, CanvasNode>;
  selection: CanvasSelection;
  pan: { x: number; y: number };
  zoom: number;
  /** A press pans, whatever it lands on: Space is held, or the hand tool is armed. */
  panning: boolean;
  toolState: ToolState;
  editingEdgeLabel: string | null;
  edgeDrag: Extract<NonNullable<PointerState["drag"]>, { kind: "edge" }> | null;
  /** A gesture is carrying items (`carriesItems`): their handles are not drawn. */
  carrying: boolean;
  snapGuides: PointerResult["guides"];
  marqueeRect: PointerState["marqueeRect"];
  onEditingEdgeLabelChange: (edgeId: string | null) => void;
  onEdgeLabelCommit: (edge: CanvasEdge, label: string) => void;
  onCardSelect: (card: CanvasNode) => void;
  onCardChange: (card: CanvasNode) => void;
  onResizeStart: (cardId: string, corner: ResizeCorner, screen: { x: number; y: number }) => void;
  onRotateStart: (cardId: string, screen: { x: number; y: number }) => void;
  onPortDown: (cardId: string, side: CanvasSide, screen: { x: number; y: number }) => void;
  onWheel: (event: React.WheelEvent<HTMLDivElement>) => void;
  onPointerDownStage: (event: React.PointerEvent<HTMLDivElement>) => void;
  /** A press during a modal transform, which only ends it; whether it was one. */
  onModalPress: (event: React.PointerEvent<HTMLDivElement>) => boolean;
  onPointerMove: (event: React.PointerEvent<HTMLDivElement>) => void;
  onPointerCancel: () => void;
  onPointerUp: (event: React.PointerEvent<HTMLDivElement>) => void;
  onDoubleClickStage: (event: React.MouseEvent<HTMLDivElement>) => void;
  handleCardPointerDown: (card: CanvasNode, event: React.PointerEvent) => void;
  handleEdgeClick: (edge: CanvasEdge, event: React.MouseEvent) => void;
  /** The item being edited, or null. */
  editing: string | null;
  /** An item's editor opened or closed. */
  onEdit: (id: string, editing: boolean) => void;
}

/** The guides across the floor, which the top view draws; a guide up the z axis has no line here. */
function CanvasSnapGuides({ guides }: { guides: PointerResult["guides"] }) {
  return (
    <>
      {guides.map((guide) =>
        guide.axis === "z" ? null : (
          <div
            key={guide.axis}
            className={cn(
              "absolute border-dashed border-primary/40",
              guide.axis === "x" ? "border-l" : "border-t",
            )}
            style={
              guide.axis === "x"
                ? { left: guide.pos, top: -4000, height: 8000, pointerEvents: "none" }
                : { top: guide.pos, left: -4000, width: 8000, pointerEvents: "none" }
            }
          />
        ),
      )}
    </>
  );
}

/**
 * The floor's dots, a step apart at the zoom: one layer a step larger than
 * the viewport each way, slid by what the pan leaves over a whole step. A
 * pan moves the layer and repaints nothing; a zoom repaints it once.
 */
function CanvasGrid({ pan, zoom }: { pan: { x: number; y: number }; zoom: number }) {
  const step = GRID_STEP * zoom;
  const over = (at: number) => (((at % step) + step) % step) - step;
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute will-change-transform"
      style={{
        left: 0,
        top: 0,
        width: `calc(100% + ${2 * step}px)`,
        height: `calc(100% + ${2 * step}px)`,
        backgroundImage:
          "radial-gradient(circle, color-mix(in oklab, var(--foreground) 4%, transparent) 1px, transparent 1px)",
        backgroundSize: `${step}px ${step}px`,
        transform: `translate(${over(pan.x)}px, ${over(pan.y)}px)`,
      }}
    />
  );
}

/** The marquee being dragged out, if one is. */
function CanvasMarquee({ rect }: { rect: PointerState["marqueeRect"] }) {
  if (rect === null) return null;
  return (
    <div
      className="absolute border border-primary/40 bg-primary/10"
      style={{
        left: Math.min(rect.x, rect.x + rect.w),
        top: Math.min(rect.y, rect.y + rect.h),
        width: Math.abs(rect.w),
        height: Math.abs(rect.h),
        pointerEvents: "none",
      }}
    />
  );
}

const sameWindow = (a: FloorWindow | null, b: FloorWindow | null) =>
  a === b ||
  (a !== null &&
    b !== null &&
    a.left === b.left &&
    a.top === b.top &&
    a.right === b.right &&
    a.bottom === b.bottom);

/**
 * The floor the stage draws (`floorWindow`) at `pan` and `zoom`, on the
 * viewport `ref` holds: one object while the view stays inside its cells,
 * so the layers draw nothing again as it moves there. What a new window
 * brings in is drawn as a deferred update, so a zoom out that brings in
 * hundreds never stalls a frame: the camera moves first and the items
 * follow, so a fast pan past a cell may show a frame or two before what it
 * brings in is drawn. That is the trade, chosen: the window is grown a
 * cell each way so that it seldom shows.
 */
function useDrawnWindow(
  ref: React.RefObject<HTMLElement | null>,
  pan: { x: number; y: number },
  zoom: number,
): FloorWindow | null {
  const size = useStageSize(ref);
  const crossed = useSteady(floorWindow(viewOfPan(pan, zoom, size), size), sameWindow);
  return useDeferredValue(crossed);
}

export function CanvasStage({
  doc,
  nodes,
  byId,
  selection,
  pan,
  zoom,
  panning,
  toolState,
  editingEdgeLabel,
  edgeDrag,
  carrying,
  snapGuides,
  marqueeRect,
  onEditingEdgeLabelChange,
  onEdgeLabelCommit,
  onCardSelect,
  onCardChange,
  onResizeStart,
  onRotateStart,
  onPortDown,
  onWheel,
  onPointerDownStage,
  onModalPress,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onDoubleClickStage,
  handleCardPointerDown,
  handleEdgeClick,
  editing,
  onEdit,
}: CanvasStageProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const window = useDrawnWindow(viewportRef, pan, zoom);
  const itemActions = useStableActions({
    onCardSelect,
    onCardChange,
    onResizeStart,
    onRotateStart,
    onPortDown,
    onCardPointerDown: handleCardPointerDown,
    onEdit,
  });
  const edgeActions = useStableActions({
    onEditingEdgeLabelChange,
    onEdgeLabelCommit,
    onEdgeClick: handleEdgeClick,
  });
  return (
    <div
      ref={viewportRef}
      data-canvas-viewport
      className={cn(
        "relative min-h-0 flex-1 overflow-hidden",
        carrying && "[&_[data-resize]]:invisible [&_[data-rotate]]:invisible",
        panning
          ? "cursor-grab"
          : toolState.tool !== "select"
            ? "cursor-crosshair"
            : "cursor-default",
      )}
      onWheel={onWheel}
      onPointerDownCapture={(event) => {
        if (onModalPress(event)) return;
        if (event.button === 1 || panning || (event.button === 0 && event.altKey)) {
          event.preventDefault();
          event.stopPropagation();
          onPointerDownStage(event);
        }
      }}
      onPointerDown={onPointerDownStage}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onDoubleClick={onDoubleClickStage}
    >
      <CanvasGrid pan={pan} zoom={zoom} />
      <div
        className="absolute inset-0 origin-top-left"
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
        }}
      >
        <CanvasEdgeLayer
          doc={doc}
          nodes={nodes}
          byId={byId}
          selection={selection}
          editingEdgeLabel={editingEdgeLabel}
          window={window}
          actions={edgeActions}
        />
        <GhostEdgePath byId={byId} edgeDrag={edgeDrag} pan={pan} zoom={zoom} />

        <CanvasSnapGuides guides={snapGuides} />

        <CanvasMarquee rect={marqueeRect} />

        <CanvasCardLayer
          doc={doc}
          selection={selection}
          editing={editing}
          window={window}
          actions={itemActions}
        />
      </div>
    </div>
  );
}
