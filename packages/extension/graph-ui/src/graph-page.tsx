import { useCallback, useEffect, useMemo, useState } from "react";
import { Result } from "effect";
import { WarningIcon } from "@phosphor-icons/react";
import { saveGraphPerspective, setGraphRenderer } from "./lens-writes";
import {
  browserHost,
  cn,
  hasText,
  listOntologyItems,
  navigate,
  OntologyPicker,
  ontologyPath,
  useAppearance,
  useAnswered,
  usePageGraph,
  useWireNodes,
  ViewSlot,
  WorkspaceState,
  useLastSettled,
} from "@kb/ui-sdk";
import {
  extractLensGraph,
  type GraphLens,
  lensReport,
  listPerspectiveNodes,
  parsePerspective,
} from "./graph-lens.ts";
import {
  buildTreeForest,
  resolvePerspective,
  DEFAULT_RENDERER,
  type LensPerspective,
  type LensRenderer,
  type RendererKey,
} from "@kb/graph";
import type { WireNode } from "@kb/contracts";
import { PerspectivePicker } from "./perspective-picker";
import { RendererSwitch } from "./renderer-switch";
import { GraphCanvasFrame } from "./graph-canvas-frame";
import type { GraphCameraControls } from "./graph-camera-controls";
import { selectionFromNode, type GraphSelection } from "./graph-selection";
import { paramsFromProps } from "@kb/views";
import { GraphFrameContext, graphViewKey, type GraphFrame } from "./graph-frame";
import { useRenderer } from "./use-renderers";
import { useGraphTrace } from "./graph-trace";
import { useRelated } from "./graph-related";
import { graphPath } from "./routes";

const EMPTY_LENS: GraphLens = { nodes: [], edges: [], dropped: 0, queryError: null };

// off-graph: GAP [[01M3EH8SRZ2NN7QZJY88CGY0T3]]
const SYS_STORAGE_KEY = "kb-graph-include-sys";

export interface GraphPageProps {
  perspectiveId: string | null;
  /**
   * Ontology scope: render member nodes and their internal edges only. No new
   * renderer — an ontology is just another way of producing the node set.
   */
  ontologyId?: string | null;
}

/** The sys switch, kept per device: whether system, command and schema nodes are drawn. */
function useIncludeSystemNodes(): readonly [boolean, () => void] {
  const [includeSystemNodes, setIncludeSystemNodes] = useState(() => {
    try {
      return localStorage.getItem(SYS_STORAGE_KEY) === "1";
    } catch {
      return false;
    }
  });
  const toggle = useCallback(() => {
    setIncludeSystemNodes((v) => {
      const next = !v;
      try {
        localStorage.setItem(SYS_STORAGE_KEY, next ? "1" : "0");
      } catch {}
      return next;
    });
  }, []);
  return [includeSystemNodes, toggle];
}

/**
 * The perspectives on offer and the one the path names (or the default), with
 * the path rewritten to name it once the list is as of now.
 */
function useActivePerspective(
  wireNodes: readonly WireNode[],
  perspectiveId: string | null,
  ontologyId: string | null,
) {
  const listed = useAnswered((run) => listPerspectiveNodes(run, wireNodes), [wireNodes]);
  const perspectiveNodes = listed.value;
  const perspectives = useMemo(() => perspectiveNodes.map(parsePerspective), [perspectiveNodes]);

  const active: LensPerspective | null = useMemo(
    () => resolvePerspective(perspectives, perspectiveId),
    [perspectives, perspectiveId],
  );

  const listSettled = listed.settled;
  useEffect(() => {
    // Under an ontology scope the URL is /o/<id>/graph; never rewrite it.
    if (!active || ontologyId !== null) return;
    // A perspective just saved is missing from a list answered before it:
    // the path is rewritten only once the list is as of now.
    if (perspectiveId !== active.id && listSettled) {
      navigate(graphPath(active.id));
    }
  }, [active, perspectiveId, ontologyId, listSettled]);

  return { listSettled, perspectiveNodes, perspectives, active };
}

interface LensScope {
  readonly wireNodes: readonly WireNode[];
  readonly active: LensPerspective | null;
  readonly includeSystemNodes: boolean;
  readonly ontologyId: string | null;
}

/**
 * The graph and the view it was extracted for, as one snapshot. `held` is
 * null until the first lens query is answered.
 */
function useLensExtraction({ wireNodes, active, includeSystemNodes, ontologyId }: LensScope) {
  const ontologyMembers = usePageGraph((s) => s.ontologyMembers);
  const restrictTo = useMemo(
    () => (ontologyId !== null ? (ontologyMembers ?? new Set<string>()) : undefined),
    [ontologyId, ontologyMembers],
  );

  // What the graph is extracted from, settled for 300ms: an edit burst
  // re-extracts once, after it, rather than on every keystroke.
  const lensInput = useMemo(
    () => ({ wireNodes, active, includeSystemNodes, restrictTo, ontologyId }),
    [wireNodes, active, includeSystemNodes, restrictTo, ontologyId],
  );
  // The first perspective to arrive is extracted at once: there is no burst
  // to wait out while nothing is drawn.
  const [extractFrom, setExtractFrom] = useState(lensInput);
  const drawing = extractFrom.active !== null;
  useEffect(() => {
    const handle = window.setTimeout(() => setExtractFrom(lensInput), drawing ? 300 : 0);
    return () => window.clearTimeout(handle);
  }, [lensInput, drawing]);

  // The graph and the view it was extracted for are one snapshot: the view
  // key renderers see always names the node set they are drawing, never the
  // next one still waiting on the debounce or on its query's answer. Until
  // the lens query is answered the graph held is the last one it answered,
  // so a write never redraws the graph from a stale answer and new nodes.
  const extraction = useAnswered(
    (run) => {
      const from = extractFrom;
      return {
        graph:
          from.active === null
            ? EMPTY_LENS
            : extractLensGraph(run, from.wireNodes, from.active, {
                includeSystemNodes: from.includeSystemNodes,
                ...(from.restrictTo ? { restrictTo: from.restrictTo } : {}),
              }),
        view: {
          id: from.active?.id ?? "",
          query: from.active?.query ?? "",
          includeSystemNodes: from.includeSystemNodes,
          ontologyId: from.ontologyId,
        },
      };
    },
    [extractFrom],
  );
  const held = useLastSettled(extraction, "graph");
  const extracted = held ?? { graph: EMPTY_LENS, view: extraction.value.view };
  return { held, lensGraph: extracted.graph, view: extracted.view };
}

/**
 * The frame's selection and the trace begun from it: selection lives on the
 * frame, not per renderer, and a node the graph no longer draws is let go.
 */
function useGraphPicking(
  active: LensPerspective | null,
  lensGraph: GraphLens,
  wireNodes: readonly WireNode[],
  rendererKey: RendererKey<unknown> | null,
) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedNode = lensGraph.nodes.find((node) => node.id === selectedId);
  const selection = selectedNode ? selectionFromNode(selectedNode) : null;
  const traced = useGraphTrace(active, lensGraph, wireNodes, selectedId);
  const related = useRelated(active, lensGraph, wireNodes, selectedId);
  const { trace, pick: pickTraceEnd, clear: clearTrace } = traced;
  // While a trace waits for its end, the next node selected is that end.
  const setSelection = useCallback(
    (value: GraphSelection | null) => {
      if (value !== null) pickTraceEnd(value.nodeId);
      setSelectedId(value?.nodeId ?? null);
    },
    [pickTraceEnd],
  );
  const [savingTrace, setSavingTrace] = useState(false);
  const saveTrace = useCallback(
    async (name: string) => {
      if (rendererKey === null || !active || trace === null || trace.to === null) return;
      setSavingTrace(true);
      try {
        const saved = await saveGraphPerspective(
          rendererKey,
          { ...active, traceFrom: trace.from, traceTo: trace.to },
          name,
        );
        // The trace stays with the perspective it was traced in; the saved one draws it.
        if ("id" in saved) navigate(graphPath(saved.id));
      } finally {
        setSavingTrace(false);
      }
    },
    [trace, rendererKey, active],
  );
  useEffect(() => {
    if (selectedId !== null && !lensGraph.nodes.some((node) => node.id === selectedId))
      setSelectedId(null);
  }, [lensGraph.nodes, selectedId]);

  const clearSelection = useCallback(() => {
    setSelectedId(null);
    clearTrace();
  }, [clearTrace]);

  return { selection, setSelection, clearSelection, traced, related, saveTrace, savingTrace };
}

/** The renderer's settings, read off the perspective node through its key. */
function useRendererSettings(
  rendererKey: RendererKey<unknown> | null,
  perspectiveNodes: readonly WireNode[],
  active: LensPerspective | null,
) {
  const activeProps = perspectiveNodes.find((node) => node.id === active?.id)?.props;
  return useMemo(
    () =>
      rendererKey !== null && activeProps !== undefined
        ? paramsFromProps(rendererKey, activeProps, null, lensReport())
        : null,
    [rendererKey, activeProps],
  );
}

interface PageFrameInput extends Pick<
  GraphFrame,
  | "lensGraph"
  | "searchHighlight"
  | "filterIds"
  | "selection"
  | "setSelection"
  | "setControls"
  | "onNodeOpen"
  | "trace"
> {
  readonly view: Parameters<typeof graphViewKey>[1] & {
    readonly id: string;
    readonly query: string;
  };
  readonly active: LensPerspective | null;
}

/** What the renderer view draws from, beside the settings it decodes from the perspective. */
function usePageFrame({
  lensGraph,
  view,
  active,
  searchHighlight,
  filterIds,
  selection,
  setSelection,
  setControls,
  onNodeOpen,
  trace,
}: PageFrameInput): GraphFrame {
  const appearance = useAppearance();
  const forest = useMemo(
    () => (active ? buildTreeForest(lensGraph.nodes, lensGraph.edges, active.focus) : []),
    [lensGraph.nodes, lensGraph.edges, active],
  );

  const layoutKey = active?.id ?? "";
  const focus = active?.focus ?? null;
  return useMemo(
    (): GraphFrame => ({
      lensGraph,
      forest,
      layoutKey,
      viewKey: graphViewKey({ ...view, focus }, view),
      appearance,
      searchHighlight,
      filterIds,
      selection,
      setSelection,
      setControls,
      onNodeOpen,
      trace,
    }),
    [
      lensGraph,
      forest,
      layoutKey,
      view,
      focus,
      appearance,
      searchHighlight,
      filterIds,
      selection,
      setSelection,
      setControls,
      onNodeOpen,
      trace,
    ],
  );
}

export default function GraphPage({ perspectiveId, ontologyId = null }: GraphPageProps) {
  const wireNodes = useWireNodes();
  const { zoomTo } = browserHost();
  const [includeSystemNodes, toggleSys] = useIncludeSystemNodes();
  const { listSettled, perspectiveNodes, perspectives, active } = useActivePerspective(
    wireNodes,
    perspectiveId,
    ontologyId,
  );
  const { held, lensGraph, view } = useLensExtraction({
    wireNodes,
    active,
    includeSystemNodes,
    ontologyId,
  });

  // Zooming navigates: in the scope, to the scope's outline.
  const onNodeOpen = useCallback((id: string) => zoomTo(id), [zoomTo]);

  const renderer = active?.renderer ?? DEFAULT_RENDERER;
  const rendererKey = useRenderer(renderer);

  // Camera controls live on the frame, not per renderer.
  const [controls, setControls] = useState<GraphCameraControls | null>(null);
  const picking = useGraphPicking(active, lensGraph, wireNodes, rendererKey);
  const { selection, setSelection, traced } = picking;
  const [searchHighlight, setSearchHighlight] = useState<Set<string> | null>(null);
  const [filterIds, setFilterIds] = useState<Set<string> | null>(null);

  const frame = usePageFrame({
    lensGraph,
    view,
    active,
    searchHighlight,
    filterIds,
    selection,
    setSelection,
    setControls,
    onNodeOpen,
    trace: traced.frame,
  });
  const settings = useRendererSettings(rendererKey, perspectiveNodes, active);

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <GraphPageHeader
        ontologyId={ontologyId}
        perspectives={perspectives}
        active={active}
        renderer={renderer}
        rendererKey={rendererKey}
        includeSystemNodes={includeSystemNodes}
        onToggleSys={toggleSys}
        lensGraph={lensGraph}
      />
      <div className="relative min-h-0 flex-1 kb-workspace-reveal">
        {!listSettled && !active ? null : !active ? (
          <WorkspaceState
            title="No graph perspectives yet"
            description="A perspective chooses which nodes and connections to explore."
          />
        ) : (
          <GraphCanvasFrame
            nodes={lensGraph.nodes}
            renderer={rendererKey}
            controls={controls}
            selectedNodeId={selection?.nodeId ?? null}
            selection={selection}
            onClearSelection={picking.clearSelection}
            onOpenNode={onNodeOpen}
            onSearchChange={setSearchHighlight}
            onFilterChange={setFilterIds}
            queryError={lensGraph.queryError}
            perspective={active}
            trace={traced}
            related={picking.related}
            onSaveTrace={(name) => void picking.saveTrace(name)}
            savingTrace={picking.savingTrace}
          >
            <GraphView
              empty={
                held !== null && lensGraph.nodes.length === 0 && !hasText(lensGraph.queryError)
              }
              renderer={renderer}
              rendererKey={rendererKey}
              settings={settings}
              frame={frame}
              subject={active.id}
            />
          </GraphCanvasFrame>
        )}
      </div>
    </div>
  );
}

interface GraphPageHeaderProps {
  readonly ontologyId: string | null;
  readonly perspectives: LensPerspective[];
  readonly active: LensPerspective | null;
  readonly renderer: LensRenderer;
  readonly rendererKey: RendererKey<unknown> | null;
  readonly includeSystemNodes: boolean;
  readonly onToggleSys: () => void;
  readonly lensGraph: GraphLens;
}

/** The page's header: which perspective, which ontology, which renderer, and what is drawn. */
function GraphPageHeader({
  ontologyId,
  perspectives,
  active,
  renderer,
  rendererKey,
  includeSystemNodes,
  onToggleSys,
  lensGraph,
}: GraphPageHeaderProps) {
  const wireNodes = useWireNodes();
  const { zoomTo } = browserHost();
  // An ontology decides WHICH nodes, a perspective decides how they look —
  // orthogonal, so both pickers sit in the header together (r5 §1.4).
  const ontologies = useMemo(() => listOntologyItems(wireNodes), [wireNodes]);
  return (
    <header className="kb-chrome flex min-h-11 shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-foreground/[0.06] px-4 py-2">
      {/* Under an ontology its own header names the scope and switches its views. */}
      {ontologyId === null ? (
        <span className="kb-display text-ui font-medium text-muted-foreground">graph</span>
      ) : null}
      <PerspectivePicker
        perspectives={perspectives}
        activeId={active?.id ?? null}
        renderer={rendererKey}
        onSelect={(id) => navigate(graphPath(id))}
      />
      {ontologies.length > 0 && ontologyId === null ? (
        <OntologyPicker
          ontologies={ontologies}
          activeId={ontologyId}
          placeholder="all nodes"
          onSelect={(id) => navigate(ontologyPath(id, "graph"))}
          onClear={() => navigate(graphPath(active?.id ?? null))}
        />
      ) : null}
      {active ? (
        <RendererSwitch
          value={renderer}
          onChange={(r: LensRenderer) => {
            void setGraphRenderer(active.id, r);
          }}
        />
      ) : null}
      <button
        type="button"
        className={cn(
          "rounded-md px-2 py-0.5 text-label font-medium transition-colors duration-100",
          includeSystemNodes
            ? "bg-foreground/[0.08] text-foreground"
            : "text-faint-foreground hover:bg-foreground/[0.04] hover:text-muted-foreground",
        )}
        data-elide-toggle="true"
        aria-pressed={includeSystemNodes}
        title={
          includeSystemNodes
            ? "Hide system, command and schema nodes"
            : "Show system, command and schema nodes"
        }
        onClick={onToggleSys}
      >
        System nodes
      </button>
      <span className="text-label text-faint-foreground">
        {lensGraph.dropped > 0
          ? `top ${lensGraph.nodes.length} of ${lensGraph.nodes.length + lensGraph.dropped} nodes by degree`
          : `${lensGraph.nodes.length} nodes`}{" "}
        · {lensGraph.edges.length} edges
      </span>
      {lensGraph.dropped > 0 && active ? (
        <button
          type="button"
          className="rounded-md bg-foreground/[0.06] px-2 py-0.5 text-caption font-medium text-foreground/60 transition-colors hover:bg-foreground/[0.1] hover:text-foreground/80"
          onClick={() => zoomTo(active.id)}
        >
          edit max-nodes
        </button>
      ) : null}
      {hasText(lensGraph.queryError) && (
        <span
          className="flex items-center gap-1 rounded-xs bg-warning/10 px-1.5 py-0.5 text-label text-warning"
          title={lensGraph.queryError}
        >
          <WarningIcon size={12} /> query error
        </span>
      )}
    </header>
  );
}

interface GraphViewProps {
  /** The lens answered with no nodes and no query error. */
  readonly empty: boolean;
  readonly renderer: LensRenderer;
  readonly rendererKey: RendererKey<unknown> | null;
  readonly settings: ReturnType<typeof useRendererSettings>;
  readonly frame: GraphFrame;
  readonly subject: string;
}

/** What the frame holds: the renderer's view, or why there is nothing to draw. */
function GraphView({ empty, renderer, rendererKey, settings, frame, subject }: GraphViewProps) {
  const unavailable = (
    <WorkspaceState
      title="Visualization unavailable"
      description={
        settings !== null && Result.isFailure(settings)
          ? `${renderer} cannot read this perspective: ${settings.failure}`
          : `No renderer is registered for ${renderer}. Choose another visualization above.`
      }
    />
  );
  if (empty)
    return (
      <WorkspaceState
        title="No nodes in view"
        description="Broaden the node query in Graph options."
      />
    );
  if (rendererKey === null || settings === null || !Result.isSuccess(settings)) return unavailable;
  return (
    <GraphFrameContext.Provider value={frame}>
      <ViewSlot
        view={rendererKey}
        params={settings.success}
        placement="page"
        fallback={unavailable}
        subject={subject}
      />
    </GraphFrameContext.Provider>
  );
}
