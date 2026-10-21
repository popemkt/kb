import { lazy, use } from "react";
import { GraphIcon } from "@phosphor-icons/react";
import type { ParamsOf } from "@kb/views";
import {
  GraphView,
  type ClusterView,
  type Force2dView,
  type Force3dView,
  type GraphParams,
  type TreeView,
  type TreemapView,
} from "@kb/graph";
import {
  keptLoad,
  navigate,
  NotFound,
  paramsOf,
  SidebarRow,
  SidebarSection,
  useAnswered,
  useWireNodes,
  ViewErrorBoundary,
  type MatchedRoute,
  type ViewProps,
} from "@kb/ui-sdk";
import { listPerspectiveNodes } from "./graph-lens";
import { listPerspectiveNavItems } from "./perspective-nav";
import { graphPath } from "./routes";

/** The renderers' chunk: sigma and graphology stay out of the outline's bundle. */
async function importRendererViews() {
  const { Force2dRenderer, TreeRenderer, ClusterRenderer, Force3dRenderer, TreemapRenderer } =
    await import("./renderer-views");
  return { Force2dRenderer, TreeRenderer, ClusterRenderer, Force3dRenderer, TreemapRenderer };
}
type RendererViews = Awaited<ReturnType<typeof importRendererViews>>;

/**
 * Loaded once and kept, so a renderer view renders at once whenever the chunk
 * has arrived; a failed load is forgotten, so the view's "Try again" loads it
 * again (`lib/kept-load`).
 */
const rendererViews = keptLoad(importRendererViews);

/**
 * The renderers' chunk: at once when it has arrived, else suspending inside
 * the renderer's own slot until it does, or throwing its failure to that slot.
 */
function useRendererViews(): RendererViews {
  return rendererViews.current() ?? use(rendererViews.load());
}

// Each renderer view as the graph plugin provides it: a component in this
// always-loaded file that draws the one in the renderers' chunk.

export function Force2dRendererView(props: ViewProps<ParamsOf<typeof Force2dView>>) {
  const { Force2dRenderer } = useRendererViews();
  return <Force2dRenderer {...props} />;
}

export function TreeRendererView(props: ViewProps<ParamsOf<typeof TreeView>>) {
  const { TreeRenderer } = useRendererViews();
  return <TreeRenderer {...props} />;
}

export function ClusterRendererView(props: ViewProps<ParamsOf<typeof ClusterView>>) {
  const { ClusterRenderer } = useRendererViews();
  return <ClusterRenderer {...props} />;
}

export function Force3dRendererView(props: ViewProps<ParamsOf<typeof Force3dView>>) {
  const { Force3dRenderer } = useRendererViews();
  return <Force3dRenderer {...props} />;
}

export function TreemapRendererView(props: ViewProps<ParamsOf<typeof TreemapView>>) {
  const { TreemapRenderer } = useRendererViews();
  return <TreemapRenderer {...props} />;
}

/** The page fetches the renderers with it, so its canvas never waits on a second round trip. */
const GraphPage = lazy(() => {
  // Fetch the renderers alongside the page, so its canvas seldom waits on a
  // second round trip; a failure here is the renderer slot's to show, not the
  // page's.
  rendererViews.load().catch(() => undefined);
  return import("./graph-page");
});

export function GraphSurface({ params }: ViewProps<GraphParams>) {
  const perspectiveId = params.perspective ?? null;
  const ontologyId = params.ontology ?? null;
  const wireNodes = useWireNodes();
  // The graphs are a query, so a perspective is missing only once that query
  // has answered as of now without it, never while the answer is on its way.
  const listed = useAnswered(
    (run) =>
      perspectiveId === null ||
      listPerspectiveNodes(run, wireNodes).some((n) => n.id === perspectiveId),
    [wireNodes, perspectiveId],
  );
  if (listed.settled && !listed.value)
    return (
      <NotFound
        what="Graph perspective"
        id={perspectiveId ?? undefined}
        back={{ label: "Graph", path: graphPath() }}
      />
    );
  return (
    <ViewErrorBoundary
      title="Graph crashed"
      resetKey={ontologyId === null ? (perspectiveId ?? "graph") : `o:${ontologyId}`}
    >
      <GraphPage perspectiveId={perspectiveId} ontologyId={ontologyId} />
    </ViewErrorBoundary>
  );
}

export function GraphSection({ route }: { readonly route: MatchedRoute | null }) {
  const wireNodes = useWireNodes();
  const perspectives = useAnswered(
    (run) => listPerspectiveNavItems(run, wireNodes),
    [wireNodes],
  ).value;
  const graph = paramsOf(route, GraphView);
  return (
    <SidebarSection>
      <SidebarRow
        label="Graph"
        icon={<GraphIcon size={14} />}
        active={graph !== null && graph.perspective === undefined}
        onClick={() => navigate(graphPath())}
      />
      {perspectives.map((p) => (
        <SidebarRow
          key={p.id}
          label={p.label}
          indented
          active={graph !== null && graph.perspective === p.id}
          onClick={() => navigate(graphPath(p.id))}
        />
      ))}
    </SidebarSection>
  );
}
