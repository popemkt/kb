import { Predicate } from "effect";
import {
  matchRoute,
  outlineLocationOf,
  RoutePoint,
  useContributions,
  WORKSPACE_ROOT_ID,
} from "@kb/ui-sdk";
import { useGraphStore, useShownNode } from "@/stores/graph.store";

/** The params a page names its subject by, in the order a title prefers them. */
const SUBJECT_KEYS = ["node", "perspective", "id", "root", "view"] as const;

/**
 * What a pane at `path` is called: the node its page is shown for, by its
 * text, else the page's view by the label the seed names it. Read off the
 * route the path resolves to, so a page names itself the same way wherever it
 * is open.
 */
export function usePaneTitle(path: string): string {
  const route = matchRoute(useContributions(RoutePoint), path);
  const subject = route === null ? undefined : subjectOf(route.params);
  const zoom = useGraphStore((s) => s.rootNodeId);
  const id = subject ?? shownZoomAt(path, zoom);
  const node = useShownNode(id === undefined || id === WORKSPACE_ROOT_ID ? null : id);
  const text = id === WORKSPACE_ROOT_ID ? "Home" : node?.text.trim();
  if (route === null) return "Not found";
  return text !== undefined && text !== "" ? text : route.view.label;
}

/**
 * The node a pane at `path` shows when it is the page's outline: the page's
 * one `zoom`, which the pane's own location names only while it is focused
 * (GAP [[01M411FP5AGQ4VB5SGJWCJAN66]]); undefined for any other path.
 */
export function shownZoomAt(path: string, zoom: string): string | undefined {
  return outlineLocationOf(path)?.ontology === null ? zoom : undefined;
}

function subjectOf(params: unknown): string | undefined {
  if (!Predicate.isObject(params)) return undefined;
  for (const key of SUBJECT_KEYS) {
    const value = params[key];
    if (typeof value === "string" && value !== "") return value;
  }
  return undefined;
}
