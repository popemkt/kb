import { RoutePoint, matchRoute, useContributions, WORKSPACE_ROOT_ID } from "@kb/ui-sdk";
import { paneSubjectAt } from "@/lib/pane-subject";
import { useGraphStore, useShownNode } from "@/stores/graph.store";

/**
 * What a pane at `path` is called: the node its page is shown for
 * (`paneSubjectAt`), by its text, else the page's view by the label the seed
 * names it. Read off the route the path resolves to, so a page names itself
 * the same way wherever it is open.
 */
export function usePaneTitle(path: string): string {
  const routes = useContributions(RoutePoint);
  const route = matchRoute(routes, path);
  const zoom = useGraphStore((s) => s.rootNodeId);
  const id = paneSubjectAt(routes, path, zoom);
  const node = useShownNode(id === undefined || id === WORKSPACE_ROOT_ID ? null : id);
  const text = id === WORKSPACE_ROOT_ID ? "Home" : node?.text.trim();
  if (route === null) return "Not found";
  return text !== undefined && text !== "" ? text : route.view.label;
}
