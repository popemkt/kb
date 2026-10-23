import { useMemo, type ReactNode } from "react";
import { Result } from "effect";
import { paramsFrom, resolveNodeView, type NodeParams, type NodeViewTarget } from "@kb/views";
import {
  logWarn,
  NotFound,
  pageFrameOf,
  RoutePoint,
  schemaOf,
  useContributions,
  ViewPoint,
  ViewSlot,
  ViewNotLoaded,
  ViewUnavailable,
  WorkspaceState,
  type ResolvedRoute,
  type ViewProps,
} from "@kb/ui-sdk";
import { PageFrame } from "./pane-frame";
import { usePageCatalog } from "@/lib/view-catalog";
import { useGraphStore } from "@/stores/graph.store";

/**
 * `/node/<id>[/<view>]`: a node in its default view, or through one view
 * (`resolveNodeView`, the one rule). It draws the view it resolves to in a
 * slot of its own, shown for the view node or the node, so a layout that
 * opens itself again is a repeat the slot refuses. It frames what it shows
 * itself (`nodePage`), so its route frames nothing (`full`).
 */
export function NodeViewSurface({ params }: ViewProps<NodeParams>) {
  // Views and their hosts are read from the whole graph, whatever scope the outline is in.
  const schema = useGraphStore(schemaOf);
  const catalog = usePageCatalog();
  const routes = useContributions(RoutePoint);
  const views = useContributions(ViewPoint);
  const page = useMemo(() => {
    const target = resolveNodeView(
      params,
      catalog,
      (id) => schema.get(id),
      (warning) => logWarn(`[kb/node] ${params.node}: ${warning}`),
    );
    return nodePage(params, target, routes, views);
  }, [params, catalog, schema, routes, views]);
  return <PageFrame frame={page.frame}>{page.body}</PageFrame>;
}

/**
 * What the node page shows, and its frame. A view is framed as the route that
 * opens it frames it, else as it says it frames a page (`View.frame`: the
 * outline and the read view scroll), else in the pane's box, unscrolled, as
 * a page with its own viewport is. Any other outcome (no
 * such node, a view this page cannot draw) is framed as a page no route
 * matched is: in a scroll region.
 */
function nodePage(
  params: NodeParams,
  target: Result.Result<NodeViewTarget, string>,
  routes: Parameters<typeof pageFrameOf>[0],
  views: Parameters<typeof pageFrameOf>[1],
): { readonly frame: ResolvedRoute["frame"]; readonly body: ReactNode } {
  if (Result.isFailure(target))
    return {
      frame: "scroll",
      body: <NotFound what="Node" id={params.node} back={{ label: "Home", path: "/" }} />,
    };
  const found = target.success;
  // A view no plugin on this page draws, or a view the data names that is broken.
  if (found.key === null)
    return {
      frame: "scroll",
      body:
        "broken" in found ? (
          <ViewUnavailable why={found.broken} placement="page" />
        ) : (
          <ViewNotLoaded label={found.listed.label} placement="page" />
        ),
    };
  const decoded = paramsFrom(found.key, found.input);
  if (Result.isFailure(decoded))
    return {
      frame: "scroll",
      body: <WorkspaceState title="This view cannot be shown" description={decoded.failure} />,
    };
  return {
    frame: pageFrameOf(routes, views, found.key, decoded.success) ?? "fixed",
    body: (
      <ViewSlot
        view={found.key}
        params={decoded.success}
        placement="page"
        subject={found.subject}
        {...(found.viewNode === undefined ? {} : { viewNode: found.viewNode })}
        fallback={<ViewNotLoaded label={found.key.label} placement="page" />}
      />
    ),
  };
}
