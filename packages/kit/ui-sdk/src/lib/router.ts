import { useSyncExternalStore } from "react";
import type { OntologyView, OutlineLocation } from "@kb/views";

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
  if (!hasLocation()) return;
  const { search, hash } = window.location;
  if (to === `${getPath()}${search}${hash}`) return;
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
 * focused pane. Moving focus or clearing a callback's URL parameters keeps
 * the current entry and its state.
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

/** `/o/<id>` (page) · `/o/<id>/outline` · `/o/<id>/graph`. */
export function ontologyPath(id: string, view: OntologyView = "page"): string {
  const base = `/o/${encodeURIComponent(id)}`;
  return view === "page" ? base : `${base}/${view}`;
}

/** `/` · `/outline/<id>`; in an ontology's scope `/o/<s>/outline` · `/o/<s>/outline/<id>`. */
export function outlinePath({ ontology, zoom }: OutlineLocation): string {
  const base = ontology === null ? "" : ontologyPath(ontology, "outline");
  if (zoom === null) return base === "" ? "/" : base;
  return `${base === "" ? "/outline" : base}/${encodeURIComponent(zoom)}`;
}

// What an outline location names is read by `@kb/views`' `location.ts`, as a stored layout's reader reads it.
export { outlineLocationOf, type OutlineLocation } from "@kb/views";
