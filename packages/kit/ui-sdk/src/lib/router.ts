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

/** Each in-app entry carries its position, even across a page reload. */
function pathIndex(): number {
  const state: unknown = hasLocation() ? window.history.state : null;
  if (typeof state !== "object" || state === null || !("kbPathIndex" in state)) return 0;
  const index = state.kbPathIndex;
  return typeof index === "number" && Number.isSafeInteger(index) && index >= 0 ? index : 0;
}

// The last entry known to this page starts at the entry it loaded.
let lastIndex = pathIndex();

export function canGo(): { back: boolean; forward: boolean } {
  const index = pathIndex();
  return { back: index > 0, forward: index < lastIndex };
}

/** Traverse only known in-app entries. The browser reports the move via popstate. */
export function go(delta: number): void {
  if (!hasLocation() || !Number.isSafeInteger(delta) || delta === 0) return;
  const target = pathIndex() + delta;
  if (target >= 0 && target <= lastIndex) window.history.go(delta);
}

function writePath(method: "pushState" | "replaceState", to: string): void {
  if (!hasLocation() || to === getPath()) return;
  const index = pathIndex();
  const push = method === "pushState";
  const next = push ? index + 1 : index;
  window.history[method]({ ...(push ? {} : window.history.state), kbPathIndex: next }, "", to);
  if (push) lastIndex = next;
  notify();
}

export function navigate(to: string): void {
  writePath("pushState", to);
}

/**
 * Show `to` in the address bar without a history entry: the URL names the
 * focused pane, and moving the focus to another pane is not a step back can
 * undo.
 */
export function replacePath(to: string): void {
  writePath("replaceState", to);
}

function onPopState(): void {
  lastIndex = Math.max(lastIndex, pathIndex());
  notify();
}

/** Call `listener` whenever the path changes, by `navigate` or by history; returns the unsubscribe. */
export function subscribePath(listener: Listener): () => void {
  if (!hasLocation()) return () => {};
  if (listeners.size === 0) window.addEventListener("popstate", onPopState);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener("popstate", onPopState);
  };
}

export function usePath(): string {
  return useSyncExternalStore(subscribePath, getPath, () => "/");
}

/** A node's location (`NodeView`'s, in `@kb/views`), where the page navigates to it. */

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
