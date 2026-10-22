import { useCallback, useMemo, useState } from "react";
import { NO_TRACE } from "./graph-trace";
import { Result } from "effect";
import {
  browserHost,
  useAppearance,
  useAnswered,
  useWireNodes,
  ViewSlot,
  WorkspaceState,
  type ViewProps,
  useLastSettled,
} from "@kb/ui-sdk";
import { buildTreeForest, type NeighbourhoodParams } from "@kb/graph";
import { extractNeighbourhood } from "./graph-neighbourhood";
import { paramsFrom } from "@kb/views";
import { GraphFrameContext, type GraphFrame } from "./graph-frame";
import { selectionFromNode, type GraphSelection } from "./graph-selection";
import { useRenderer } from "./use-renderers";

const EMPTY = { nodes: [], edges: [], dropped: 0, queryError: null };

/**
 * A node's neighbourhood, drawn by a renderer view: the host of that
 * renderer, the way the graph page is the host of the whole graph. It
 * extracts the neighbourhood (`extractNeighbourhood`), hands it to the
 * renderer in a `GraphFrame`, and draws the renderer through a slot filling
 * its own box, for its root, so a neighbourhood shown inside another stops
 * at the first repeat.
 */
export function NeighbourhoodGraph({ params }: ViewProps<NeighbourhoodParams>) {
  const { root, hops, edges, renderer, settings } = params;
  const wireNodes = useWireNodes();
  const { zoomTo } = browserHost();
  const appearance = useAppearance();
  const rendererKey = useRenderer(renderer);

  // The neighbourhood is one query per edge and direction; until they have
  // all answered it reaches only the root, so it is drawn once they have.
  const answered = useAnswered(
    (run) => extractNeighbourhood(run, wireNodes, { root, hops, edges }),
    [wireNodes, root, hops, edges],
  );
  const held = useLastSettled(answered, [root, hops, ...edges].join("\n"));
  const lensGraph = held ?? EMPTY;
  const forest = useMemo(
    () => buildTreeForest(lensGraph.nodes, lensGraph.edges, root),
    [lensGraph, root],
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = lensGraph.nodes.find((node) => node.id === selectedId);
  const selection = selected === undefined ? null : selectionFromNode(selected);
  const setSelection = useCallback(
    (value: GraphSelection | null) => setSelectedId(value?.nodeId ?? null),
    [],
  );
  const onNodeOpen = useCallback((id: string) => zoomTo(id), [zoomTo]);
  const layoutKey = `neighbourhood:${root}:${hops}`;
  const frame = useMemo(
    (): GraphFrame => ({
      lensGraph,
      forest,
      layoutKey,
      viewKey: [layoutKey, edges.join(",")].join("\n"),
      appearance,
      searchHighlight: null,
      filterIds: null,
      selection,
      setSelection,
      setControls: () => undefined,
      onNodeOpen,
      trace: NO_TRACE,
    }),
    [lensGraph, forest, layoutKey, edges, appearance, selection, setSelection, onNodeOpen],
  );

  const drawn = rendererKey === null ? null : paramsFrom(rendererKey, settings);
  const unavailable = (
    <WorkspaceState
      title="Neighbourhood unavailable"
      description={
        drawn !== null && Result.isFailure(drawn)
          ? `${renderer} cannot draw these settings: ${drawn.failure}`
          : `No renderer is registered for ${renderer}.`
      }
    />
  );
  // "Nothing to draw" is a finding only once the queries have answered.
  if (held === null) return null;
  if (lensGraph.nodes.length === 0)
    return (
      <WorkspaceState
        title="Nothing to draw"
        description="This node's neighbourhood holds no nodes the graph shows."
      />
    );
  return (
    <div className="relative h-full min-h-40 w-full" data-neighbourhood-root={root}>
      {rendererKey !== null && drawn !== null && Result.isSuccess(drawn) ? (
        <GraphFrameContext.Provider value={frame}>
          <ViewSlot
            view={rendererKey}
            params={drawn.success}
            placement="page"
            fallback={unavailable}
            subject={root}
          />
        </GraphFrameContext.Provider>
      ) : (
        unavailable
      )}
    </div>
  );
}
