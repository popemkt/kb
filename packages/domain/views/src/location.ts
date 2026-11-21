/**
 * kb's locations: the paths a pane holds (DESIGN.md → Layout views → A pane
 * holds a location), read back as what they name. Each is read here, once,
 * so the route table, the page and a reader of a stored layout agree on what
 * a location names; the router (`@kb/ui-sdk`) builds the outline's links.
 */
import type { NodeParams } from "./layout.ts";

/**
 * {@link NodeView}'s location: `/node/<id>`, a node in its default view;
 * `/node/<id>/<view>`, the node through one view (a view node it names, or a
 * view type by its option). What a page navigates to and `view.openings`
 * names, so both say one path.
 */
export function nodePath(node: string, view?: string): string {
  const base = `/node/${encodeURIComponent(node)}`;
  return view === undefined ? base : `${base}/${encodeURIComponent(view)}`;
}

/** The node location `path` names (`nodePath`), or null when it names none (or does not decode). */
export function nodeLocationOf(path: string): NodeParams | null {
  const match = /^\/node\/([^/]+)(?:\/([^/]+))?\/?$/.exec(path);
  const node = match?.[1];
  if (node === undefined) return null;
  const view = match?.[2];
  try {
    return view === undefined
      ? { node: decodeURIComponent(node) }
      : { node: decodeURIComponent(node), view: decodeURIComponent(view) };
  } catch {
    return null;
  }
}

/**
 * Where the page's outline stands: at its home, or zoomed to a node, in an
 * ontology's scope or in none. The zoom is a place, so it is a path like any
 * other: a zoom is a step back can undo, and a reload or a link lands there.
 */
export interface OutlineLocation {
  readonly ontology: string | null;
  readonly zoom: string | null;
}

/** The outline location `path` names, or null when it names none (or does not decode). */
export function outlineLocationOf(path: string): OutlineLocation | null {
  if (path === "/") return { ontology: null, zoom: null };
  const match = /^(?:\/o\/([^/]+))?\/outline(?:\/([^/]+))?\/?$/.exec(path);
  if (match === null) return null;
  const [, ontology, zoom] = match;
  // `/outline` alone names no place: the unscoped outline's home is `/`.
  if (ontology === undefined && zoom === undefined) return null;
  try {
    return {
      ontology: ontology === undefined ? null : decodeURIComponent(ontology),
      zoom: zoom === undefined ? null : decodeURIComponent(zoom),
    };
  } catch {
    return null;
  }
}
