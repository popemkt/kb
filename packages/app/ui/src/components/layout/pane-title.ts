import { useEffect } from "react";
import {
  RoutePoint,
  matchRoute,
  rowName,
  schemaOf,
  useContributions,
  WORKSPACE_ROOT_ID,
} from "@kb/ui-sdk";
import { paneSubjectAt } from "@/lib/pane-subject";
import { useGraphStore, useShownNode } from "@/stores/graph.store";

/**
 * What a pane at `path` is called: the node its page is shown for
 * (`paneSubjectAt`), by its name (`rowName`, DESIGN.md → Display text), else
 * the page's view by the label the seed names it. Read off the route the
 * path resolves to, so a page names itself the same way wherever it is open.
 */
export function usePaneTitle(path: string): string {
  const routes = useContributions(RoutePoint);
  const route = matchRoute(routes, path);
  const schema = useGraphStore(schemaOf);
  const id = useGraphStore((s) => paneSubjectAt(routes, path, s));
  const node = useShownNode(id === undefined || id === WORKSPACE_ROOT_ID ? null : id);
  const text = id === WORKSPACE_ROOT_ID ? "Home" : node === undefined ? "" : rowName(node, schema);
  if (route === null) return "Not found";
  return text !== "" ? text : route.view.label;
}

/** The browser tab's title: the focused pane's title (`usePaneTitle`), then kb. */
export function useDocumentTitle(path: string): void {
  const title = usePaneTitle(path);
  useEffect(() => {
    document.title = `${title} — kb`;
  }, [title]);
}
