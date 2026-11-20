import { Predicate } from "effect";
import { matchRoute, outlineLocationOf } from "@kb/ui-sdk";

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
  zoom: string,
): string | undefined {
  const shown = shownZoomAt(path, zoom);
  if (shown !== undefined) return shown;
  const route = matchRoute(routes, path);
  return route === null ? undefined : subjectOf(route.params);
}

/**
 * An outline's explicit zoom, or the page's one `zoom` at the unscoped home.
 * The pane's own location names the zoom only while it is focused
 * (GAP [[01M411FP5AGQ4VB5SGJWCJAN66]]).
 */
export function shownZoomAt(path: string, zoom: string): string | undefined {
  const outline = outlineLocationOf(path);
  return outline?.zoom ?? (outline?.ontology === null ? zoom : undefined);
}

function subjectOf(params: unknown): string | undefined {
  if (!Predicate.isObject(params)) return undefined;
  for (const key of SUBJECT_KEYS) {
    const value = params[key];
    if (typeof value === "string" && value !== "") return value;
  }
  return undefined;
}
