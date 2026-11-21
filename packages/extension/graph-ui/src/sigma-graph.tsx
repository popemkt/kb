import {
  graphLabelFont,
  prefersReducedMotion,
  readTiming,
  readTokenColor,
  type Appearance,
} from "@kb/ui-sdk";
import type { LensNode } from "./graph-lens";
import {
  type LensEdge,
  edgeKey,
  type LensLayout,
  type LensLabelDensity,
  type LensLinkStyle,
} from "@kb/graph";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type Sigma from "sigma";
import {
  graphEmphasisAlpha,
  graphFocus,
  graphNeighborhood,
  showsHoverCard,
  type GraphEmphasis,
} from "./graph-interaction.ts";
import { computeLayoutPositions } from "./graph-layouts";
import { createFA2Layout, type FA2Controller } from "./fa2-layout";
import { clusterPlacement, DiscSettle, discRadius, discSpacing, linkWidth } from "./graph-discs";
import { fitView } from "./graph-camera";
import { sigmaCameraControls, type GraphCameraControls } from "./graph-camera-controls";
import type { GraphSelection } from "./graph-selection";
import { setGraphLabelPaint } from "./sigma-labels.ts";
import { SigmaBullets } from "./sigma-bullets";
import { DEFAULT_GRAPH_THEME, restingLink, type GraphTheme } from "./graph-themes";
import { withGraphAlpha } from "./graph-dim";
import { GraphTooltip } from "./graph-tooltip";
import { sigmaEmphasis, type SigmaEmphasis } from "./sigma-emphasis";
import {
  edgeProgram,
  mountSigma,
  NODE_PROGRAMS,
  wireSigmaInput,
  withCameraIntent,
} from "./sigma-renderer";

export interface SigmaGraphProps extends GraphEmphasis {
  nodes: LensNode[];
  edges: LensEdge[];
  onNodeOpen: (id: string) => void;
  onSelectionChange?: (sel: GraphSelection | null) => void;
  layoutKey: string;
  appearance: Appearance;
  layout?: LensLayout;
  cluster?: boolean;
  showLabels?: boolean;
  labelDensity?: LensLabelDensity;
  /** The link style: 2D draws its shape (a flow is drawn still, on its curve). */
  linkStyle?: LensLinkStyle;
  /**
   * The theme (`graph-themes`): 2D draws its node form, its links' tone and
   * its label style; the 3D scene's dress is the 3D graph's alone.
   */
  theme?: GraphTheme;
  onControlsReady?: (controls: GraphCameraControls | null) => void;
  /** Shift-click with a node selected: trace from the selection to the clicked node. */
  onTraceTo?: (id: string) => void;
  /** Each link's label, its relation's (`lens.edge-labels`); absent draws no link labels. */
  edgeLabel?: (edge: LensEdge) => string;
}

/** Above this many nodes, label density thins with the square root of the count. */
const LABEL_CROWD = 400;

/** A single Sigma lifecycle owns both force and cluster interaction. */
export function SigmaGraph(props: SigmaGraphProps) {
  const {
    nodes,
    edges,
    layoutKey,
    appearance,
    layout = "force",
    cluster = false,
    selectedNodeId,
    highlightIds,
    filterIds,
    traceIds,
    edgeLabel,
    showLabels = true,
    labelDensity = "medium",
    linkStyle = "straight",
    theme = DEFAULT_GRAPH_THEME,
  } = props;
  const { form } = theme;
  const containerRef = useRef<HTMLDivElement>(null);
  const hullRef = useRef<HTMLCanvasElement>(null);
  const sigmaRef = useRef<Sigma | null>(null);
  const layoutRef = useRef<FA2Controller | null>(null);
  // Sigma's handlers and reducers read the latest props and isolation; they
  // are written after render, before any effect or handler can run.
  const live = useRef(props);
  const hovered = useRef<string | null>(null);
  const cameraIntent = useRef(false);
  const topology = useRef("");
  const settle = useRef(new DiscSettle());
  const bullets = useRef(new SigmaBullets());
  const [isolated, setIsolated] = useState<string | null>(null);
  const isolatedRef = useRef(isolated);
  useLayoutEffect(() => {
    live.current = props;
    isolatedRef.current = isolated;
  });
  const [tooltip, setTooltip] = useState<{ id: string; x: number; y: number } | null>(null);

  const emphasis = useRef<SigmaEmphasis | null>(null);
  const refresh = useCallback(() => {
    const sigma = sigmaRef.current;
    if (!sigma) return;
    const state = live.current;
    const active = graphFocus(state.selectedNodeId, hovered.current);
    const neighborhood = graphNeighborhood(active, state.edges);
    const graph = sigma.getGraph();
    emphasis.current?.retarget({
      active,
      narrowed:
        active !== null ||
        state.highlightIds !== undefined ||
        state.filterIds !== undefined ||
        state.traceIds !== undefined,
      presence: (id) => {
        const a = graphEmphasisAlpha(id, state, neighborhood);
        return isolatedRef.current !== null &&
          graph.getNodeAttribute(id, "clusterKey") !== isolatedRef.current
          ? a * 0.2
          : a;
      },
    });
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;
    const mounted = mountSigma(el, {
      form: (live.current.theme ?? DEFAULT_GRAPH_THEME).form,
      linkStyle: live.current.linkStyle ?? "straight",
      bullets: bullets.current,
      hullCanvas: cluster ? hullRef.current : null,
    });
    const { sigma } = mounted;
    sigmaRef.current = sigma;
    emphasis.current = sigmaEmphasis(sigma, readTiming(), prefersReducedMotion);
    topology.current = "";
    settle.current.reset();
    cameraIntent.current = false;
    const markCamera = () => {
      cameraIntent.current = true;
    };
    live.current.onControlsReady?.(
      withCameraIntent(
        sigmaCameraControls(() => sigmaRef.current),
        markCamera,
      ),
    );
    const unwire = wireSigmaInput(sigma, el, {
      target: () => live.current,
      hulls: mounted.hulls,
      layout: () => layoutRef.current,
      hovered,
      markCamera,
      refresh,
      setTooltip,
      isolate: (key) => setIsolated((previous) => (previous === key ? null : key)),
    });
    return () => {
      unwire();
      emphasis.current?.dispose();
      emphasis.current = null;
      layoutRef.current?.kill();
      layoutRef.current = null;
      mounted.unmount();
      sigmaRef.current = null;
      live.current.onControlsReady?.(null);
    };
  }, [layoutKey, layout, cluster, refresh]);

  useEffect(() => {
    const sigma = sigmaRef.current;
    if (!sigma) return;
    const graph = sigma.getGraph();
    const key =
      nodes
        .map((n) => `${n.id}:${cluster ? n.clusterKey : ""}`)
        .toSorted()
        .join("|") +
      "/" +
      edges
        .map((e) => `${e.kind}:${e.source}:${e.target}:${e.weight}`)
        .toSorted()
        .join("|");
    const changed = key !== topology.current;
    const initial = topology.current === "";
    if (changed) {
      layoutRef.current?.kill();
      layoutRef.current = null;
      graph.clearEdges();
    }
    const ids = new Set(nodes.map((n) => n.id));
    for (const id of graph.nodes()) if (!ids.has(id)) graph.dropNode(id);
    const assigned = computeLayoutPositions(layout, nodes, edges, undefined, discSpacing);
    // Where the theme draws bullets, each node's entry in the bullet table and its box.
    const drawn = form === "bullet" ? bullets.current.place(nodes.map((n) => n.bullet)) : null;
    const placed = cluster ? clusterPlacement(nodes) : null;
    nodes.forEach((n, index) => {
      const exists = graph.hasNode(n.id);
      let point = assigned?.get(n.id);
      if (cluster && (!exists || graph.getNodeAttribute(n.id, "clusterKey") !== n.clusterKey)) {
        point = placed?.get(n.id);
      }
      const attrs = {
        label: n.label,
        color: n.color,
        size: discRadius(n.size),
        degree: n.degree,
        clusterKey: n.clusterKey,
        clusterLabel: n.clusterLabel ?? n.clusterKey,
        ...drawn?.[index],
      };
      if (exists) graph.mergeNodeAttributes(n.id, { ...attrs, ...(cluster ? point : undefined) });
      else
        graph.addNode(n.id, {
          ...attrs,
          ...(point ?? {
            x: Math.cos(index * 2.4) * Math.sqrt(index + 1) * 12,
            y: Math.sin(index * 2.4) * Math.sqrt(index + 1) * 12,
          }),
        });
    });
    if (changed)
      edges.forEach((e) => {
        if (ids.has(e.source) && ids.has(e.target))
          graph.addEdgeWithKey(edgeKey(e), e.source, e.target, {
            size: linkWidth(e.weight),
            kind: e.kind,
            label: live.current.edgeLabel?.(e),
          });
      });
    topology.current = key;
    if (changed) emphasis.current?.reindex(initial);
    if (changed && graph.order && !cluster && layout === "force") {
      const fa = createFA2Layout(graph, {
        onConverged: () => {
          sigma.refresh();
          if (initial && !cameraIntent.current) fitView(sigma);
        },
      });
      layoutRef.current = fa;
      fa.start();
    }
    settle.current.written(graph, nodes, {
      reshaped: changed,
      moving: layoutRef.current?.isRunning() === true,
    });
    sigma.refresh();
    if (initial && graph.order) fitView(sigma, 0);
    refresh();
  }, [nodes, edges, layoutKey, layout, cluster, form, refresh]);

  useEffect(() => {
    const sigma = sigmaRef.current;
    if (!sigma) return;
    // Everything sigma copied out of the tokens is re-read on an appearance
    // change, and what the theme shapes on a new theme.
    const look = theme;
    sigma.setSetting("labelFont", graphLabelFont(look.labels.face));
    const ground = readTokenColor("--background");
    const ink = readTokenColor("--foreground");
    // One colour per link: 2D takes the tone's strength and accent lean, not its gradient.
    const resting = restingLink(
      readTokenColor("--graph-edge"),
      ink,
      readTokenColor("--primary"),
      look.links,
    );
    const edgeColor = withGraphAlpha(resting.color, resting.alpha);
    sigma.setSetting("defaultEdgeColor", edgeColor);
    sigma
      .getGraph()
      .forEachEdge((edge) => sigma.getGraph().setEdgeAttribute(edge, "color", edgeColor));
    emphasis.current?.setRings(ground, ink);
    setGraphLabelPaint({ text: ink, ground }, look.labels);
    bullets.current.setPage(ink, ground);
    sigma.setSetting("defaultNodeType", NODE_PROGRAMS[look.form]);
    sigma.setSetting("renderLabels", showLabels);
    // Density-aware: the busier the graph, the fewer labels per grid cell.
    const crowd = Math.min(1, Math.sqrt(LABEL_CROWD / Math.max(1, nodes.length)));
    sigma.setSetting(
      "labelDensity",
      (labelDensity === "low" ? 0.25 : labelDensity === "high" ? 1 : 0.65) * crowd,
    );
    sigma.setSetting("hideEdgesOnMove", nodes.length > 1500);
    // Link labels are the edges' own attribute, keyed as the topology pass keys them.
    edges.forEach((e) => {
      const key = edgeKey(e);
      if (sigma.getGraph().hasEdge(key))
        sigma.getGraph().setEdgeAttribute(key, "label", edgeLabel?.(e));
    });
    sigma.setSetting("renderEdgeLabels", edgeLabel !== undefined);
    sigma.setSetting("edgeLabelFont", graphLabelFont(look.labels.face));
    sigma.setSetting("edgeLabelSize", 10);
    sigma.setSetting("edgeLabelColor", { color: readTokenColor("--muted-foreground") });
    refresh();
  }, [
    appearance,
    theme,
    showLabels,
    labelDensity,
    nodes,
    edges,
    edgeLabel,
    layoutKey,
    layout,
    cluster,
    refresh,
  ]);
  useEffect(() => {
    // A new link style redraws the links in their new shape, in place.
    sigmaRef.current?.setSetting("defaultEdgeType", edgeProgram(linkStyle));
  }, [linkStyle]);
  useEffect(() => {
    refresh();
  }, [selectedNodeId, highlightIds, filterIds, traceIds, isolated, refresh]);
  const meta = tooltip ? nodes.find((n) => n.id === tooltip.id) : null;
  return (
    <div
      className="relative h-full w-full min-h-0 kb-workspace-reveal"
      data-testid={cluster ? "cluster-graph" : undefined}
    >
      {cluster ? (
        <canvas ref={hullRef} className="pointer-events-none absolute inset-0 h-full w-full" />
      ) : null}
      <div ref={containerRef} className="absolute inset-0" data-sigma-container="true" />
      {isolated !== null ? (
        <button
          type="button"
          className="absolute bottom-3 left-3 z-20 rounded-md bg-popover px-3 py-1 text-meta leading-4 shadow-raised"
          onClick={() => setIsolated(null)}
        >
          Clear cluster:{" "}
          {nodes.find((n) => n.clusterKey === isolated)?.clusterLabel ?? "Selected group"} ×
        </button>
      ) : null}
      {tooltip && meta && showsHoverCard(selectedNodeId) ? (
        <GraphTooltip node={meta} x={tooltip.x} y={tooltip.y} />
      ) : null}
    </div>
  );
}
