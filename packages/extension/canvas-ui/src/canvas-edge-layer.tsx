/**
 * The 2D canvas's edges: each its route's path (`edgeRoute`, `@kb/canvas`),
 * stroked as its look says (`edgePaint`), the heads its ends wear drawn as
 * their own outlines (`edgeHead`) — the ones the 3D scene lays flat — and
 * its label halfway along the route. The ghost of an edge being drawn
 * follows the pointer.
 */
import {
  edgeHead,
  edgeRoute,
  looseRoute,
  routeMidpoint,
  sideTerminal,
  svgPathData,
  type CanvasDoc,
  type CanvasEdge,
  type CanvasNode,
  type EdgeRoute,
  toneCss,
  edgePaint,
  type EdgePaint,
} from "@kb/canvas";
import { memo } from "react";
import { edgeUnbound } from "./canvas-api";
import type { CanvasSelection } from "./canvas-selection";
import type { PointerState } from "./canvas-pointer";
import { hasText, type OutlineNode } from "@kb/ui-sdk";
import { clientToCanvas } from "./canvas-camera";
import { LABEL_FIELD, labelChip } from "./canvas-chrome";
import { routeInWindow, type FloorWindow } from "./canvas-visible";

/** What an edge does when it is pressed and its label edited, by the page: one object for the life of the stage (`useStableActions`). */
interface CanvasEdgeActions {
  onEditingEdgeLabelChange: (edgeId: string | null) => void;
  onEdgeLabelCommit: (edge: CanvasEdge, label: string) => void;
  onEdgeClick: (edge: CanvasEdge, event: React.MouseEvent) => void;
}

interface CanvasEdgeLayerProps {
  doc: CanvasDoc;
  nodes: ReadonlyMap<string, OutlineNode>;
  byId: ReadonlyMap<string, CanvasNode>;
  selection: CanvasSelection;
  editingEdgeLabel: string | null;
  /** The floor drawn (`floorWindow`): an edge whose route lies outside it is not drawn, but for a selected one. Null draws every edge. */
  window: FloorWindow | null;
  actions: CanvasEdgeActions;
}

/** What one edge is drawn from: it, the items at its ends, how it is shown, and the page's actions. */
interface CanvasEdgeViewProps {
  edge: CanvasEdge;
  route: EdgeRoute;
  selected: boolean;
  unbound: boolean;
  editingLabel: boolean;
  actions: CanvasEdgeActions;
}

type EdgeLabelProps = Pick<CanvasEdgeViewProps, "edge" | "editingLabel" | "actions"> & {
  at: { x: number; y: number };
};

/** An edge's label, halfway along its route: a chip, or the field that edits it. */
function EdgeLabel({ edge, at, editingLabel, actions }: EdgeLabelProps) {
  const { onEdgeLabelCommit, onEditingEdgeLabelChange } = actions;
  if (editingLabel) {
    return (
      <foreignObject
        x={at.x - LABEL_FIELD.width / 2}
        y={at.y - LABEL_FIELD.height / 2}
        width={LABEL_FIELD.width}
        height={LABEL_FIELD.height}
      >
        <input
          autoFocus
          type="text"
          className="h-full w-full rounded-xs border border-primary/40 bg-popover px-1 text-center text-label"
          defaultValue={edge.label ?? ""}
          onBlur={(ev) => {
            const val = ev.currentTarget.value.trim();
            onEdgeLabelCommit(edge, val);
            onEditingEdgeLabelChange(null);
          }}
          onKeyDown={(ev) => {
            if (ev.key === "Enter" || ev.key === "Escape") {
              ev.currentTarget.blur();
            }
            ev.stopPropagation();
          }}
        />
      </foreignObject>
    );
  }
  if (!hasText(edge.label)) return null;
  return (
    <g
      transform={`translate(${at.x}, ${at.y})`}
      className="cursor-pointer"
      onDoubleClick={(ev) => {
        ev.stopPropagation();
        onEditingEdgeLabelChange(edge.id);
      }}
    >
      <rect
        {...labelChip(edge.label)}
        rx={4}
        className="fill-popover stroke-foreground/10"
        strokeWidth={1}
      />
      <text
        textAnchor="middle"
        dominantBaseline="central"
        className="fill-foreground/70 text-label font-medium"
        style={{ pointerEvents: "none" }}
      >
        {edge.label}
      </text>
    </g>
  );
}

/** The heads an edge's ends wear, in its ink: filled, or stroked as heavy as its line. */
function EdgeHeads({
  edge,
  route,
  paint,
  ink,
}: {
  edge: CanvasEdge;
  route: EdgeRoute;
  paint: EdgePaint;
  ink: string;
}) {
  return (["from", "to"] as const).map((end) => {
    const head = edgeHead(edge, route, end, paint.headLength);
    if (head === null) return null;
    return (
      <path
        key={end}
        data-edge-head={end}
        data-head-kind={head.kind}
        d={svgPathData(head.path)}
        fill={head.filled ? ink : "none"}
        stroke={ink}
        strokeWidth={head.filled ? 0 : paint.width}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="pointer-events-none transition-colors"
      />
    );
  });
}

/**
 * One edge: its line, its heads and its label, along its route. Drawn again
 * only when one of those changes — the route is the same object while
 * neither end moved (`edgeRoute`), so a drag draws again the edges of what
 * it carries and no other.
 */
const CanvasEdgeView = memo(function CanvasEdgeView({
  edge,
  route,
  selected,
  unbound,
  editingLabel,
  actions,
}: CanvasEdgeViewProps) {
  const d = svgPathData(route.path);
  const paint = edgePaint(edge, { selected, unbound });
  const ink = toneCss(paint.ink);
  const { onEdgeClick: handleEdgeClick, onEditingEdgeLabelChange } = actions;
  return (
    <g
      data-edge-id={edge.id}
      data-selected={selected ? "" : undefined}
      opacity={paint.opacity === 1 ? undefined : paint.opacity}
    >
      {/* Fat transparent hit area */}
      <path
        d={d}
        fill="none"
        stroke="transparent"
        strokeWidth={20}
        className="cursor-pointer"
        onClick={(ev) => handleEdgeClick(edge, ev)}
        onDoubleClick={(ev) => {
          ev.stopPropagation();
          onEditingEdgeLabelChange(edge.id);
        }}
      />
      {/* Visible stroke */}
      <path
        data-edge-path
        d={d}
        fill="none"
        stroke={paint.line === null ? "none" : ink}
        strokeWidth={paint.width}
        strokeDasharray={
          paint.line === null || paint.line.pattern.length === 0
            ? undefined
            : paint.line.pattern.join(" ")
        }
        className="pointer-events-none transition-colors"
      >
        {unbound && <title>prop no longer present — rebind?</title>}
      </path>
      <EdgeHeads edge={edge} route={route} paint={paint} ink={ink} />
      <EdgeLabel
        edge={edge}
        at={routeMidpoint(route)}
        editingLabel={editingLabel}
        actions={actions}
      />
    </g>
  );
});

/** The edge being drawn, from its card's side to the pointer, over the edges: the one part of them that follows the camera. */
export function GhostEdgePath({
  byId,
  edgeDrag,
  pan,
  zoom,
}: {
  byId: ReadonlyMap<string, CanvasNode>;
  edgeDrag: Extract<NonNullable<PointerState["drag"]>, { kind: "edge" }> | null;
  pan: { x: number; y: number };
  zoom: number;
}) {
  if (!edgeDrag) return null;
  const from = byId.get(edgeDrag.fromCardId);
  const stageEl = document.querySelector("[data-canvas-viewport]");
  if (!from || !stageEl) return null;
  const { width, height } = stageEl.getBoundingClientRect();
  // The drag holds a viewport point: the viewport is its own origin.
  const viewport = { left: 0, top: 0, width, height };
  const end = clientToCanvas({ x: edgeDrag.x, y: edgeDrag.y }, viewport, pan, zoom);
  const route = looseRoute(sideTerminal(from, edgeDrag.fromSide), end);
  return (
    <svg
      className="pointer-events-none absolute top-0 left-0 overflow-visible"
      width={1}
      height={1}
    >
      <path
        data-testid="canvas-connection-preview"
        d={svgPathData(route.path)}
        fill="none"
        stroke="var(--primary)"
        strokeWidth={1.5}
        strokeDasharray="4 4"
        className="pointer-events-none"
        opacity={0.6}
      />
    </svg>
  );
}

/** The edges whose two ends are on the canvas: those the floor drawn meets, and the selected ones wherever they are. */
export const CanvasEdgeLayer = memo(function CanvasEdgeLayer({
  doc,
  nodes,
  byId,
  selection,
  editingEdgeLabel,
  window,
  actions,
}: CanvasEdgeLayerProps) {
  return (
    <svg
      className="pointer-events-none absolute top-0 left-0 overflow-visible"
      width={8000}
      height={8000}
    >
      <g className="pointer-events-auto">
        {doc.edges.map((edge) => {
          const from = byId.get(edge.fromNode);
          const to = byId.get(edge.toNode);
          if (!from || !to) return null;
          const route = edgeRoute(from, to, edge);
          const selected = selection.edgeIds.has(edge.id);
          if (window !== null && !selected && !routeInWindow(window, route)) return null;
          return (
            <CanvasEdgeView
              key={edge.id}
              edge={edge}
              route={route}
              selected={selected}
              unbound={edgeUnbound(edge, nodes)}
              editingLabel={editingEdgeLabel === edge.id}
              actions={actions}
            />
          );
        })}
      </g>
    </svg>
  );
});
