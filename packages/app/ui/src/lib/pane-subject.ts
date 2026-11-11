import { Predicate } from "effect";
import { matchRoute, outlineLocationOf } from "@kb/ui-sdk";

/** The params a page names its subject by, in the order a title prefers them. */
const SUBJECT_KEYS = ["node", "perspective", "id", "root", "view"] as const;

/**
 * The node a pane at `path` is shown for: the subject its route names, else,
 * as the page's outline, the page's one `zoom`; undefined for a page shown for
 * no node. What a pane is titled by (`usePaneTitle`), and the node the page
 * stands at for a command (`pageCommandApi`).
 */
export function paneSubjectAt(
  routes: Parameters<typeof matchRoute>[0],
  path: string,
  zoom: string,
): string | undefined {
  const route = matchRoute(routes, path);
  return (route === null ? undefined : subjectOf(route.params)) ?? shownZoomAt(path, zoom);
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
