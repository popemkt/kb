import type { OntologyScopeParams, NoParams } from "@kb/views";
import { outlineLocationOf } from "@kb/ui-sdk";

export function matchOntologyList(path: string): NoParams | null {
  return path === "/o" || path === "/o/" ? {} : null;
}

/**
 * `/o/<id>` (page) · `/o/<id>/outline[/<zoom>]` · `/o/<id>/graph`: one
 * ontology's scope. Its outline's zoom is the outline location's.
 */
export function matchOntologyScope(path: string): OntologyScopeParams | null {
  const outline = outlineLocationOf(path);
  if (outline !== null && outline.ontology !== null)
    return { id: outline.ontology, view: "outline" };
  const match = /^\/o\/([^/]+)(?:\/(outline|graph))?\/?$/.exec(path);
  const id = match?.[1];
  if (id === undefined) return null;
  const view = match?.[2];
  return {
    id: decodeURIComponent(id),
    view: view === "outline" || view === "graph" ? view : "page",
  };
}
