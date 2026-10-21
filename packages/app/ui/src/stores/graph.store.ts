/**
 * The browser's live graph: the replica every projection reads, the write
 * history over it, and where the page stands in it — the zoom root and the
 * ontology scope, and what the scope shows (`scopedWireOf`, `shownNodesOf`).
 * It names no projection. The projection the page stands in reads its rows
 * from this store, so they are never out of step with it; what the
 * projection holds of its own — which rows are open, and its focus — follows
 * each move through `PageProjection`, the port a plugin provides.
 */
import { useSyncExternalStore } from "react";
import { create } from "zustand";
import {
  getPath,
  inScope,
  navigate,
  type OutlineLocation,
  outlineLocationOf,
  outlinePath,
  replacePath,
  shownNodesOf,
  subscribePath,
  type GraphChange,
  EMPTY_PROJECTION,
  type PageGraphState,
  type PageProjection,
  PageProjectionService,
  type RemoteIndex,
  type ScopeSource,
  toast,
  UNDO_DEPTH,
  WORKSPACE_ROOT_ID,
  type NodeMap,
  type OutlineNode,
  type QueryAnswers,
  ReplicaQueries,
} from "@kb/ui-sdk";
import { followProvided, portSlot } from "@/stores/port-slot";
import type { ActionRequest, WireNode } from "@kb/contracts";
import { resolveScope } from "@/lib/ontology-scope";
import { mergeTx } from "@/lib/tx";
import { pageClock, replicaOver } from "@/session/engine";
import { ingestBrowserTx, installBrowserNodes, replaceBrowserSession } from "@/session/runtime";

/** Who listens for an answer arriving, whichever replica's answers it is. */
const answerListeners = new Set<() => void>();

/**
 * Listen for an answer to any of the page's queries arriving: what a reader
 * of the answers follows beside the graph (`pageGraph`). It outlives a load,
 * which brings new answers.
 */
export function subscribeAnswers(listener: () => void): () => void {
  answerListeners.add(listener);
  return () => answerListeners.delete(listener);
}

/** The replica's query answers over `index`'s engine, told to the page's answer listeners. */
function answersOver(index: RemoteIndex): QueryAnswers {
  const queries = new ReplicaQueries(index.transport, () => index.generation, pageClock);
  queries.subscribe(() => {
    for (const listener of answerListeners) listener();
  });
  return queries;
}

/** One write, as the inverse-invocation pair that undoes and redoes it. */
interface UndoEntry {
  undo: ActionRequest[];
  redo: ActionRequest[];
}

/**
 * The store: the page's graph state (`PageGraphState`) and the rest of what
 * it holds. The index is built once in `hydrateFromWire`, `applyTx` is
 * incremental, and a snapshot resync rebuilds it; it is the same instance
 * across an ontology scope, so writes, backlinks and #query nodes keep honest
 * reach while what the page shows is restricted to the scope's members
 * (`scopedWireOf`).
 */
interface GraphState extends PageGraphState {
  /** The replica: its node set here, its engine in a worker (`replicaOver`). */
  readonly index: RemoteIndex | null;
  rev: number;
  loadSource: "api" | "fixtures" | null;
  loadError: string | null;
  /** Non-fatal resolution warnings (cycle, bad EDN, unknown ref, cap). */
  ontologyWarnings: string[];
  /** rootNodeId to return to when the scope is left. */
  preScopeRootId: string | null;
  undoStack: UndoEntry[];
  redoStack: UndoEntry[];

  hydrateFromWire: (nodes: WireNode[], rev: number, source: "api" | "fixtures") => void;
  /** Apply node-level delta (optimistic edits + WS tx). */
  applyTx: (upserts: WireNode[], deletes: string[], opts?: { rev?: number }) => void;
  /** Re-read the snapshot after the shared local action advanced the existing index. */
  syncFromIndex: () => void;
  /** Full-snapshot resync (rev gap) that preserves zoom and scope. */
  refreshFromWire: (nodes: WireNode[], rev: number) => void;
  /** Enter (id) / leave (null) an ontology scope. */
  setOntologyScope: (id: string | null) => void;
  /**
   * Whether the page can show `id`, leaving the ontology scope when `id` is
   * outside it: a scope is never a dead end.
   */
  reach: (id: string) => boolean;
  zoomTo: (id: string) => void;
  zoomHome: () => void;
  /** Leave the ontology scope for where the page stood before it entered. */
  leaveScope: () => void;
  search: (query: string) => Array<{ id: string; text: string }>;
  /** Push an undo entry (trims redo tail). */
  recordUndo: (entry: UndoEntry) => void;
  /** Pop undoStack and move the same inverse-invocation pair to redoStack. */
  applyUndo: () => UndoEntry | null;
  /** Pop redoStack and move the same inverse-invocation pair to undoStack. */
  applyRedo: () => UndoEntry | null;
}

/** Data half of `GraphState` — every member that is not a function. */
export type GraphStateData = {
  [K in keyof GraphState as GraphState[K] extends (...args: never) => unknown
    ? never
    : K]: GraphState[K];
};

export const initialGraphState: GraphStateData = {
  wireNodes: [],
  index: null,
  queries: null,
  rev: 0,
  loadSource: null,
  loadError: null,
  rootNodeId: WORKSPACE_ROOT_ID,
  homeRootId: WORKSPACE_ROOT_ID,
  ontologyId: null,
  ontologyMembers: null,
  ontologyWarnings: [],
  preScopeRootId: null,
  undoStack: [],
  redoStack: [],
};

const installed = portSlot<PageProjection>(EMPTY_PROJECTION);

/** The projection the page stands in now: the installed one, else {@link EMPTY_PROJECTION}. */
export const pageProjection = installed.current;

/** Listen for a change to what the projection holds of its own, or to which one is installed. */
export const subscribeProjection = installed.subscribe;

/**
 * Install the page's projection: the one a plugin provides while it is loaded
 * (`PageProjectionService`), or a test's stand-in. With none installed the
 * graph moves on its own: no one is told, and what a withdrawn projection
 * holds of its own stays as it was. One installed
 * after a graph has loaded follows it at once, as a fresh load: its expansion
 * is read again from storage, and its focus and transient rows start empty.
 * Installing the one already installed does nothing.
 */
export function providePageProjection(next: PageProjection): void {
  if (pageProjection() === next) return;
  installed.install(next);
  const state = useGraphStore.getState();
  if (state.index !== null) next.follow("load", state, state);
}

/**
 * Uninstall `leaving`, if it is still the one this store tells. It leaves
 * the page first, as a page move does, so an empty row it minted is pruned
 * rather than left behind.
 */
export function withdrawPageProjection(leaving: PageProjection): void {
  if (pageProjection() !== leaving) return;
  leavePage(leaving);
  installed.withdraw(leaving);
}

/**
 * The page is about to leave where it stands: `projection` lets go of its
 * focus, and the empty row it minted there, if any, is pruned while the page
 * still shows it — a transaction of this store's own, which the projection
 * follows like any other.
 */
function leavePage(projection: PageProjection = pageProjection()): void {
  const minted = projection.leave(now());
  if (minted !== null) applyTx([], [minted]);
}

/** What the page shows of the graph now (`shownNodesOf`), each row at its default collapse. */
export function shownNodes(): NodeMap {
  return shownNodesOf(useGraphStore.getState());
}

/**
 * What the page shows of the graph, read by this component: for a reader of
 * what a row says (its text, its props), never of whether it is open.
 */
export function useShownNodes(): NodeMap {
  return useSyncExternalStore(useGraphStore.subscribe, shownNodes, shownNodes);
}

/** One node of what the page shows: this component re-renders when that node changes. */
export function useShownNode(id: string | null): OutlineNode | undefined {
  const read = () => (id === null ? undefined : shownNodes().get(id));
  return useSyncExternalStore(useGraphStore.subscribe, read, read);
}

/**
 * The resolution of scope `ontologyId` over `wire`, as the state holds it:
 * from the answers the page has, so a scope whose query is not answered yet
 * is resolved again when it is (`subscribeAnswers`, below).
 */
function scopeFields(
  wire: WireNode[],
  ontologyId: string | null,
  queries: QueryAnswers | null,
): Pick<GraphStateData, "ontologyMembers" | "ontologyWarnings"> {
  if (ontologyId === null) return { ontologyMembers: null, ontologyWarnings: [] };
  const resolution = resolveScope(wire, ontologyId, queries);
  return { ontologyMembers: resolution.members, ontologyWarnings: resolution.warnings };
}

/** Deleted nodes must not remain the zoom root. */
function clampedRoot(next: ScopeSource, prev: GraphStateData): string {
  return inScope(next, prev.rootNodeId) ? prev.rootNodeId : prev.homeRootId;
}

function now(): GraphState {
  return useGraphStore.getState();
}

/**
 * Move to `patch` by `change`: the projection follows first, then the store
 * moves once, and the queries the page keeps live are asked again.
 */
function moveTo(change: GraphChange, patch: Partial<GraphStateData>): void {
  const prev = now();
  pageProjection().follow(change, prev, { ...prev, ...patch });
  useGraphStore.setState(patch);
  now().queries?.moved();
}

/**
 * Replace the whole graph state with `next`, as a load the projection follows:
 * how a test stands a fresh, unloaded graph up.
 */
export function replaceGraph(next: GraphStateData): void {
  pageProjection().follow("load", now(), next);
  useGraphStore.setState(next);
}

// The replica's moves.

function hydrateFromWire(wireNodes: WireNode[], rev: number, source: "api" | "fixtures"): void {
  // A fresh load starts unscoped; App re-applies the URL scope after.
  now().index?.close();
  const index = replicaOver(wireNodes);
  const queries = answersOver(index);
  replaceBrowserSession(wireNodes, rev, index, queries, {
    onLocalCommit: syncFromIndex,
    applyServerTx: (tx, txRev) => applyTx(tx.upserts, tx.deletes, { rev: txRev }),
    installServerSnapshot: (nodes, snapshotRev) => refreshFromWire(nodes, snapshotRev),
  });
  moveTo("load", {
    wireNodes,
    index,
    queries,
    rev,
    loadSource: source,
    loadError: null,
    rootNodeId: WORKSPACE_ROOT_ID,
    homeRootId: WORKSPACE_ROOT_ID,
    ontologyId: null,
    ontologyMembers: null,
    ontologyWarnings: [],
    preScopeRootId: null,
    undoStack: [],
    redoStack: [],
  });
}

function applyTx(upserts: WireNode[], deletes: string[], opts?: { rev?: number }): void {
  const prev = now();
  ingestBrowserTx({ upserts, deletes });
  const wireNodes = mergeTx(prev.wireNodes, upserts, deletes);
  const scope = scopeFields(wireNodes, prev.ontologyId, prev.queries);
  const next = { wireNodes, ontologyId: prev.ontologyId, ...scope };
  moveTo("tx", {
    ...next,
    rev: opts?.rev ?? prev.rev,
    rootNodeId: clampedRoot(next, prev),
  });
}

function syncFromIndex(): void {
  const prev = now();
  if (prev.index === null) return;
  const wireNodes = prev.index.storedNodes();
  const scope = scopeFields(wireNodes, prev.ontologyId, prev.queries);
  const next = { wireNodes, ontologyId: prev.ontologyId, ...scope };
  moveTo("sync", { ...next, rootNodeId: clampedRoot(next, prev) });
}

function refreshFromWire(wireNodes: WireNode[], rev: number): void {
  const prev = now();
  if (prev.index !== null) installBrowserNodes(wireNodes);
  const scope = scopeFields(wireNodes, prev.ontologyId, prev.queries);
  const next = { wireNodes, ontologyId: prev.ontologyId, ...scope };
  moveTo("resync", { ...next, rev, rootNodeId: clampedRoot(next, prev) });
}

// Where the page stands: the scope and the zoom.

function setOntologyScope(id: string | null): void {
  if (now().ontologyId === id) return;
  leavePage();
  moveTo("scope", scopeMove(now(), id));
}

/** Where scope `id` (or none) puts the page from `st`. */
function scopeMove(st: GraphStateData, id: string | null): Partial<GraphStateData> {
  const scope = scopeFields(st.wireNodes, id, st.queries);
  if (id === null) {
    // Leaving: return to the root the user was on before entering.
    const restored =
      st.preScopeRootId !== null &&
      inScope({ wireNodes: st.wireNodes, ontologyId: null, ...scope }, st.preScopeRootId)
        ? st.preScopeRootId
        : WORKSPACE_ROOT_ID;
    return {
      ontologyId: null,
      ...scope,
      preScopeRootId: null,
      rootNodeId: restored,
      homeRootId: WORKSPACE_ROOT_ID,
    };
  }
  // Entering: the ontology becomes both the zoom root and home, so an
  // exit path always exists even if the previous root is not a member.
  return {
    ontologyId: id,
    ...scope,
    preScopeRootId: st.ontologyId === null ? st.rootNodeId : st.preScopeRootId,
    rootNodeId: id,
    homeRootId: id,
  };
}

/**
 * How the page reaches `id` from `st`: it shows it already (`"shown"`), it
 * leaves the scope (that move), or no scope shows it (null). Derived once;
 * `reach` makes the move and `reachedState` reads where it lands.
 */
function reachMove(st: GraphStateData, id: string): "shown" | Partial<GraphStateData> | null {
  if (inScope(st, id)) return "shown";
  if (st.ontologyId === null || !st.wireNodes.some((n) => n.id === id)) return null;
  const move = scopeMove(st, null);
  return inScope({ ...st, ...move }, id) ? move : null;
}

/**
 * The graph state in which the page can show `id`: this one, or this one with
 * the scope left when `id` is outside it; null when neither shows it. What
 * `reach` moves to, read without moving.
 */
export function reachedState(id: string): GraphStateData | null {
  const st = now();
  const move = reachMove(st, id);
  if (move === null) return null;
  return move === "shown" ? st : { ...st, ...move };
}

/**
 * Whether the page can show `id`, leaving the scope when `id` is outside it.
 * Leaving the scope is going somewhere, so it is pushed as the outline's
 * location, where the page then stands.
 */
function reach(id: string): boolean {
  const move = reachMove(now(), id);
  if (move === null) return false;
  if (move === "shown") return true;
  leaveScopeBy(move);
  const { rootNodeId, homeRootId } = now();
  navigate(outlinePath({ ontology: null, zoom: rootNodeId === homeRootId ? null : rootNodeId }));
  return true;
}

/** Leave the scope by `move` (`reachMove`), saying so. */
function leaveScopeBy(move: Partial<GraphStateData>): void {
  leavePage();
  moveTo("scope", move);
  toast("Left the ontology to follow that node");
}

/**
 * Stand the page at `rootNodeId`: the projection lets go of where the page
 * is, then lands at where it will be, then this store moves, in one write.
 */
function standAt(at: "zoom" | "home", rootNodeId: string): void {
  leavePage();
  pageProjection().arrive(at, { ...now(), rootNodeId });
  useGraphStore.setState({ rootNodeId });
}

/**
 * Zooming is navigating: the zoom is pushed as the focused pane's location,
 * and the page stands where the location names (`followOutlineLocation`),
 * so back undoes it and a reload lands there. Where there is no address bar
 * to follow, the page stands there itself.
 */
function zoomTo(id: string): void {
  const st = now();
  const move = reachMove(st, id);
  if (move === null) return;
  const reached = move === "shown" ? st : { ...st, ...move };
  const at = { ontology: reached.ontologyId, zoom: id === reached.homeRootId ? null : id };
  navigate(outlinePath(at));
  // The scope is left on the ontology surface's next render, and where no
  // address bar is followed nothing stands the page: leave and stand here.
  if (move !== "shown" && now().ontologyId !== null) leaveScopeBy(move);
  standAtLocation(at);
}

function zoomHome(): void {
  const at = { ontology: now().ontologyId, zoom: null };
  navigate(outlinePath(at));
  standAtLocation(at);
}

/** Stand the page at `at` in the scope it is in: its zoom, else its home. */
function standAtLocation(at: OutlineLocation): void {
  const { rootNodeId, homeRootId } = now();
  const target = at.zoom ?? homeRootId;
  if (target !== rootNodeId) standAt(at.zoom === null ? "home" : "zoom", target);
}

/**
 * Leave the ontology scope for the outline at the zoom the page stood at
 * before it entered: a navigation, so back returns into the scope.
 */
function leaveScope(): void {
  const { preScopeRootId } = now();
  navigate(
    outlinePath({
      ontology: null,
      zoom: preScopeRootId === null || preScopeRootId === WORKSPACE_ROOT_ID ? null : preScopeRootId,
    }),
  );
}

/** Whether the page is standing where the URL names, so its own store writes are not followed. */
let following = false;

/**
 * The page follows the outline location the URL names: on load, on back and
 * forward, and when a link or a command moves the focused pane there. A zoom
 * gesture has already stood the page where it pushed (`zoomTo`), so this is
 * a no-op for it. The scope is the ontology surface's to follow, so a
 * location in a scope the page has not entered yet waits for it; a location
 * whose node the page cannot show is replaced by the scope's home.
 */
function followOutlineLocation(): void {
  if (following) return;
  following = true;
  try {
    const at = outlineLocationOf(getPath());
    const st = now();
    if (at === null || st.loadSource === null || at.ontology !== st.ontologyId) return;
    const shown = at.zoom === null || inScope(st, at.zoom) ? at : { ...at, zoom: null };
    if (shown !== at) replacePath(outlinePath(shown));
    standAtLocation(shown);
  } finally {
    following = false;
  }
}

/** Keep the page at the outline location the URL names. Returns the unsubscribe. */
export function startOutlineLocation(): () => void {
  followOutlineLocation();
  const unsubscribePath = subscribePath(followOutlineLocation);
  const unsubscribeGraph = useGraphStore.subscribe(followOutlineLocation);
  return () => {
    unsubscribePath();
    unsubscribeGraph();
  };
}

function search(query: string): Array<{ id: string; text: string }> {
  const st = now();
  if (st.index === null) return [];
  const q = query.trim();
  if (!q) return [];
  return st.index
    .search(q, 50)
    .filter((n) => inScope(st, n.id))
    .map((n) => ({ id: n.id, text: n.text }));
}

// The write history.

function recordUndo(entry: UndoEntry): void {
  useGraphStore.setState((s) => ({
    undoStack: [...s.undoStack.slice(-(UNDO_DEPTH - 1)), entry],
    redoStack: [],
  }));
}

function applyUndo(): UndoEntry | null {
  const st = now();
  const entry = st.undoStack[st.undoStack.length - 1];
  if (!entry) return null;
  useGraphStore.setState((s) => ({
    undoStack: s.undoStack.slice(0, -1),
    redoStack: [...s.redoStack.slice(-(UNDO_DEPTH - 1)), entry],
  }));
  return entry;
}

function applyRedo(): UndoEntry | null {
  const st = now();
  const entry = st.redoStack[st.redoStack.length - 1];
  if (!entry) return null;
  useGraphStore.setState((s) => ({
    redoStack: s.redoStack.slice(0, -1),
    undoStack: [...s.undoStack.slice(-(UNDO_DEPTH - 1)), entry],
  }));
  return entry;
}

export const useGraphStore = create<GraphState>()(() => ({
  ...initialGraphState,
  hydrateFromWire,
  applyTx,
  syncFromIndex,
  refreshFromWire,
  setOntologyScope,
  reach,
  zoomTo,
  zoomHome,
  leaveScope,
  search,
  recordUndo,
  applyUndo,
  applyRedo,
}));

// The projection a plugin provides is the one this store tells.
followProvided(PageProjectionService, providePageProjection, withdrawPageProjection);

/**
 * A scope's members come from its query's answer, which arrives after the
 * move that entered the scope or changed the graph: when it does, the scope
 * is resolved again, and the page moves only if its members changed.
 */
subscribeAnswers(() => {
  const st = now();
  if (st.ontologyId === null) return;
  const scope = scopeFields(st.wireNodes, st.ontologyId, st.queries);
  if (sameMembers(scope.ontologyMembers, st.ontologyMembers)) return;
  const next = { wireNodes: st.wireNodes, ontologyId: st.ontologyId, ...scope };
  moveTo("sync", { ...scope, rootNodeId: clampedRoot(next, st) });
});

function sameMembers(a: Set<string> | null, b: Set<string> | null): boolean {
  if (a === null || b === null) return a === b;
  return a.size === b.size && [...a].every((id) => b.has(id));
}
