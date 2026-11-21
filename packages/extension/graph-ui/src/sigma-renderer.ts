/**
 * The sigma renderer's lifecycle, in its named steps: `mountSigma` builds the
 * instance and its label pipeline, `wireSigmaInput` turns the person's
 * pointer into hover, selection, opening, tracing, isolation and drag, and
 * each returns its own teardown. `SigmaGraph`'s lifecycle effect is the calls
 * and the teardowns in reverse; the graph it draws is written by the
 * topology pass, which shares its placement with every renderer
 * (`computeLayoutPositions`).
 */
import Graph from "graphology";
import Sigma from "sigma";
import { EdgeArrowProgram } from "sigma/rendering";
import { EdgeCurvedArrowProgram } from "@sigma/edge-curve";
import { createNodeBorderProgram } from "@sigma/node-border";
import type { LensLinkStyle } from "@kb/graph";
import { asInstance, graphLabelFont, pointerKind, type PointerKind } from "@kb/ui-sdk";
import type { LensNode } from "./graph-lens";
import { LINK_STYLES } from "./graph-link-styles";
import type { FA2Controller } from "./fa2-layout";
import { NodeDrag } from "./graph-drag";
import { placedDrag, sigmaDragSurface } from "./sigma-drag";
import type { GraphCameraControls } from "./graph-camera-controls";
import { selectionFromNode, type GraphSelection } from "./graph-selection";
import {
  drawGraphLabel,
  drawGraphHover,
  placeGraphLabels,
  reserveInGraphLabels,
  resetGraphLabels,
  type GraphNodeBox,
} from "./sigma-labels.ts";
import { createBulletProgram, type SigmaBullets } from "./sigma-bullets";
import type { NodeForm } from "./graph-themes";
import { clusterHulls } from "./cluster-hulls";

/**
 * Nodes are drawn with a ring: the ground colour at rest, so a node reads
 * clean against the links and neighbours behind it, and the ink for the node
 * in focus. `sigma-emphasis` picks the ring colour per node.
 */
const NodeRingProgram = createNodeBorderProgram({
  borders: [
    { size: { value: 0.16 }, color: { attribute: "ringColor" } },
    { size: { fill: true }, color: { attribute: "color" } },
  ],
  drawLabel: drawGraphLabel,
  drawHover: drawGraphHover,
});

/**
 * The sigma node program each form is drawn with: a solid is its disc in
 * 2D, and a bullet is the outline's bullet (`sigma-bullets`).
 */
export const NODE_PROGRAMS: Record<NodeForm, "ring" | "bullet"> = {
  sphere: "ring",
  cube: "ring",
  bullet: "bullet",
};

/** The sigma edge program each link shape is drawn with. */
const EDGE_PROGRAMS = { straight: EdgeArrowProgram, curved: EdgeCurvedArrowProgram } as const;
export const edgeProgram = (style: LensLinkStyle): keyof typeof EDGE_PROGRAMS =>
  LINK_STYLES[style].curved ? "curved" : "straight";

/** What made a press sigma reports: its captors hear mouse and touch events, a pointer's kind when it is one. */
const pointerOf = (original: MouseEvent | TouchEvent): PointerKind =>
  "pointerType" in original
    ? pointerKind(String(original.pointerType))
    : "touches" in original
      ? "touch"
      : "mouse";

/** Drawn nodes at least this big (CSS px radius) keep labels off themselves. */
const MIN_BLOCKING_RADIUS = 3;

export interface SigmaMountOptions {
  readonly form: NodeForm;
  readonly linkStyle: LensLinkStyle;
  readonly bullets: SigmaBullets;
  /** The canvas cluster hulls are drawn on; null draws none. */
  readonly hullCanvas: HTMLCanvasElement | null;
}

export interface MountedSigma {
  readonly sigma: Sigma;
  /** The cluster hulls drawn under the graph, when it is clustered. */
  readonly hulls: ReturnType<typeof clusterHulls> | null;
  readonly unmount: () => void;
}

/**
 * A sigma instance on `el` over an empty graph, with the frame's one label
 * layout: node boxes are sampled before a frame, and after it cluster titles
 * take their places first, then the node labels sigma asked for.
 */
export function mountSigma(el: HTMLElement, options: SigmaMountOptions): MountedSigma {
  const graph = new Graph({ multi: true, type: "directed" });
  const sigma = new Sigma(graph, el, {
    allowInvalidContainer: true,
    labelFont: graphLabelFont(),
    labelSize: 12,
    labelRenderedSizeThreshold: 0,
    labelDensity: 0.7,
    defaultDrawNodeLabel: drawGraphLabel,
    defaultDrawNodeHover: drawGraphHover,
    defaultNodeType: NODE_PROGRAMS[options.form],
    nodeProgramClasses: { ring: NodeRingProgram, bullet: createBulletProgram(options.bullets) },
    defaultEdgeType: edgeProgram(options.linkStyle),
    edgeProgramClasses: EDGE_PROGRAMS,
    stagePadding: 70,
    zIndex: true,
    // A node is a disc in the layout's space (`graph-discs`): its size scales with the layout.
    itemSizesReference: "positions",
    zoomToSizeRatioFunction: (ratio) => ratio,
  });
  // A glyph painted before the UI face has loaded is painted again once it has.
  let mounted = true;
  if ("fonts" in document)
    void document.fonts.ready.then(() => {
      if (!mounted) return;
      options.bullets.paint();
      sigma.refresh();
    });
  // The drawn nodes' boxes are what labels must not cover. They are sampled
  // when the frame's first label is placed (see resetGraphLabels), after
  // sigma has processed this frame's positions and camera.
  const sampleNodes = (out: GraphNodeBox[]) => {
    graph.forEachNode((id, attrs) => {
      const display = sigma.getNodeDisplayData(id);
      if (!display || display.hidden) return;
      const r = sigma.scaleSize(display.size);
      if (r < MIN_BLOCKING_RADIUS) return;
      const at = sigma.framedGraphToViewport(display);
      const degree = typeof attrs.degree === "number" ? attrs.degree : 0;
      out.push({ x: at.x - r - 1, y: at.y - r - 1, width: 2 * r + 2, height: 2 * r + 2, degree });
    });
  };
  sigma.on("beforeRender", () => {
    resetGraphLabels(
      el.querySelectorAll<HTMLCanvasElement>("canvas.sigma-labels, canvas.sigma-hovers"),
      sampleNodes,
    );
  });
  const hulls = options.hullCanvas ? clusterHulls(sigma, options.hullCanvas) : null;
  sigma.on("afterRender", () => {
    const labels = el.querySelector<HTMLCanvasElement>("canvas.sigma-labels");
    if (labels === null) return;
    hulls?.draw((box) => reserveInGraphLabels(labels, box));
    placeGraphLabels(labels);
  });
  if (import.meta.env.MODE === "test-render")
    (el as HTMLElement & { __kbSigma?: Sigma }).__kbSigma = sigma;
  return {
    sigma,
    hulls,
    unmount: () => {
      mounted = false;
      sigma.kill();
      delete (el as HTMLElement & { __kbSigma?: Sigma }).__kbSigma;
    },
  };
}

/** Camera verbs that first mark the camera as the person's, so a settling layout leaves it be. */
export function withCameraIntent(
  controls: GraphCameraControls,
  mark: () => void,
): GraphCameraControls {
  return {
    ...controls,
    fit: () => {
      mark();
      controls.fit();
    },
    reset: () => {
      mark();
      controls.reset();
    },
    zoomIn: () => {
      mark();
      controls.zoomIn();
    },
    zoomOut: () => {
      mark();
      controls.zoomOut();
    },
    focusNode: (id) => {
      mark();
      controls.focusNode(id);
    },
  };
}

/** What a press asks of the graph: read when it lands, so it always meets the latest props. */
interface SigmaPickTarget {
  readonly nodes: readonly LensNode[];
  readonly selectedNodeId?: string | null;
  readonly onNodeOpen: (id: string) => void;
  readonly onSelectionChange?: (selection: GraphSelection | null) => void;
  readonly onTraceTo?: (id: string) => void;
}

export interface SigmaInput {
  readonly target: () => SigmaPickTarget;
  readonly hulls: MountedSigma["hulls"];
  /** The force layout while one runs: a drag moves a node in it, else in the placed layout. */
  readonly layout: () => FA2Controller | null;
  /** The node under the pointer, which emphasis reads. */
  readonly hovered: { current: string | null };
  readonly markCamera: () => void;
  readonly refresh: () => void;
  readonly setTooltip: (tooltip: { id: string; x: number; y: number } | null) => void;
  /**
   * A click on the stage of a clustered graph: on a cluster's hull it isolates
   * that cluster, or lets it go when it is isolated; off every hull (null) it
   * lets any isolated cluster go.
   */
  readonly isolate: (clusterKey: string | null) => void;
}

/**
 * The person's pointer on the graph: hover, a click that selects, opens or
 * traces, a click on the stage that clears or isolates a cluster, and a
 * press that drags a node. Returns what takes it all back off.
 */
export function wireSigmaInput(sigma: Sigma, el: HTMLElement, input: SigmaInput): () => void {
  const { target, hulls, hovered, markCamera, refresh, setTooltip } = input;
  const placed = placedDrag(sigma.getGraph());
  const drag = new NodeDrag(() => input.layout() ?? placed, sigmaDragSurface(sigma));
  let suppressClick = false;
  /** The node the last click landed on, which a double-click must land on again to open. */
  let clicked: string | null = null;
  el.addEventListener("pointerdown", markCamera);
  el.addEventListener("wheel", markCamera, { passive: true });
  sigma.on("enterNode", ({ node }) => {
    hovered.current = node;
    el.style.cursor = "pointer";
    const display = sigma.getNodeDisplayData(node);
    if (display) setTooltip({ id: node, ...sigma.framedGraphToViewport(display) });
    refresh();
  });
  sigma.on("leaveNode", () => {
    hovered.current = null;
    el.style.cursor = "default";
    setTooltip(null);
    refresh();
  });
  const clickNode = (node: string, original: unknown) => {
    clicked = node;
    const native = asInstance(original, MouseEvent);
    const current = target();
    if (native?.metaKey === true || native?.ctrlKey === true) {
      current.onNodeOpen(node);
      return;
    }
    const { selectedNodeId: from, onTraceTo } = current;
    if (native?.shiftKey === true && onTraceTo && typeof from === "string" && from !== node) {
      onTraceTo(node);
      return;
    }
    const meta = current.nodes.find((n) => n.id === node);
    if (meta) current.onSelectionChange?.(selectionFromNode(meta));
  };
  sigma.on("clickNode", ({ node, event }) => {
    if (suppressClick) {
      suppressClick = false;
      clicked = null;
      return;
    }
    clickNode(node, event.original);
  });
  // Sigma reads any second click inside its timeout as a double-click,
  // wherever it lands: only one whose first click hit this node opens it;
  // any other is the click it is (select A, then click or shift-click B).
  sigma.on("doubleClickNode", ({ node, event }) => {
    event.preventSigmaDefault();
    if (clicked === node) target().onNodeOpen(node);
    else clickNode(node, event.original);
    clicked = null;
  });
  sigma.on("clickStage", ({ event }) => {
    clicked = null;
    if (suppressClick) {
      suppressClick = false;
      return;
    }
    target().onSelectionChange?.(null);
    const key = hulls?.hit(event.x, event.y);
    if (key !== undefined && key !== "") input.isolate(key);
  });
  sigma.on("downNode", ({ node, event }) => {
    event.preventSigmaDefault();
    suppressClick = false;
    drag.down(node, event.x, event.y, pointerOf(event.original));
  });
  const move = (e: MouseEvent) => {
    const rect = el.getBoundingClientRect();
    const x = e.clientX - rect.left,
      y = e.clientY - rect.top;
    if (hovered.current !== null) setTooltip({ id: hovered.current, x, y });
    if (e.target instanceof Node && el.contains(e.target)) hulls?.hover(x, y);
    drag.move(x, y);
  };
  const up = () => {
    suppressClick = drag.up();
  };
  document.addEventListener("mousemove", move);
  document.addEventListener("mouseup", up);
  return () => {
    el.removeEventListener("pointerdown", markCamera);
    el.removeEventListener("wheel", markCamera);
    document.removeEventListener("mousemove", move);
    document.removeEventListener("mouseup", up);
  };
}
