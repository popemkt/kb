import { useSyncExternalStore } from "react";
import type { OntologyView } from "@kb/views";

/**
 * Tiny path router — no react-router dependency. Which page owns a path is
 * not written here: each surface plugin matches its own (`lib/plugins`), and
 * this module only tracks the path and builds the links other views share.
 */

type Listener = () => void;
const listeners = new Set<Listener>();

function notify(): void {
  for (const l of listeners) l();
}

/**
 * Whether there is an address bar to read and write. A store driven outside
 * a page (a test in Node) has none: the router reads `/`, as its server
 * snapshot does, and a navigation moves nothing.
 */
function hasLocation(): boolean {
  return typeof window !== "undefined";
}

export function getPath(): string {
  return hasLocation() ? window.location.pathname || "/" : "/";
}

export function navigate(to: string): void {
  if (!hasLocation() || to === getPath()) return;
  window.history.pushState({}, "", to);
  notify();
}

/**
 * Show `to` in the address bar without a history entry: the URL names the
 * focused pane, and moving the focus to another pane is not a step back can
 * undo.
 */
export function replacePath(to: string): void {
  if (!hasLocation() || to === getPath()) return;
  window.history.replaceState({}, "", to);
  notify();
}

/** Call `listener` whenever the path changes, by `navigate` or by history; returns the unsubscribe. */
export function subscribePath(listener: Listener): () => void {
  listeners.add(listener);
  window.addEventListener("popstate", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("popstate", listener);
  };
}

export function usePath(): string {
  return useSyncExternalStore(subscribePath, getPath, () => "/");
}

/**
 * `/node/<id>`: a node in its default view; `/node/<id>/<view>`: the node
 * through one view (a view node it names, or a view type by its option).
 */
export function nodePath(node: string, view?: string): string {
  const base = `/node/${encodeURIComponent(node)}`;
  return view === undefined ? base : `${base}/${encodeURIComponent(view)}`;
}

/** `/o/<id>` (page) · `/o/<id>/outline` · `/o/<id>/graph`. */
export function ontologyPath(id: string, view: OntologyView = "page"): string {
  const base = `/o/${encodeURIComponent(id)}`;
  return view === "page" ? base : `${base}/${view}`;
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

/** `/` · `/outline/<id>`; in an ontology's scope `/o/<s>/outline` · `/o/<s>/outline/<id>`. */
export function outlinePath({ ontology, zoom }: OutlineLocation): string {
  const base = ontology === null ? "" : ontologyPath(ontology, "outline");
  if (zoom === null) return base === "" ? "/" : base;
  return `${base === "" ? "/outline" : base}/${encodeURIComponent(zoom)}`;
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
