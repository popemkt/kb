import { Predicate } from "effect";
import { matchRoute, outlineLocationOf, type PageGraphState, zoomAt } from "@kb/ui-sdk";

/** The params a page names its subject by, in the order a title prefers them. */
const SUBJECT_KEYS = ["node", "perspective", "id", "root", "view"] as const;

/**
 * The node a pane at `path` is shown for: its outline zoom or the subject
 * its route names. What a pane is titled by (`usePaneTitle`) and what a
 * command reads as the focused pane's subject (`pageCommandApi`).
 */
export function paneSubjectAt(
  routes: Parameters<typeof matchRoute>[0],
  path: string,
  graph: PageGraphState,
): string | undefined {
  const shown = shownZoomAt(path, graph);
  if (shown !== undefined) return shown;
  const route = matchRoute(routes, path);
  return route === null ? undefined : subjectOf(route.params);
}

/**
 * The node an outline at `path` stands at: in the page's scope, its zoom as
 * `zoomAt` reads it (its home at the home); in another scope, the zoom the
 * location names. Undefined where `path` names no outline location.
 */
export function shownZoomAt(path: string, graph: PageGraphState): string | undefined {
  const outline = outlineLocationOf(path);
  if (outline === null) return undefined;
  return outline.ontology === graph.ontologyId ? zoomAt(graph, path) : (outline.zoom ?? undefined);
}

function subjectOf(params: unknown): string | undefined {
  if (!Predicate.isObject(params)) return undefined;
  for (const key of SUBJECT_KEYS) {
    const value = params[key];
    if (typeof value === "string" && value !== "") return value;
  }
  return undefined;
}
