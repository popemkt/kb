/**
 * The outline editor's state: which rows the reader opened or closed, the row
 * being edited and the row selected, the caret hand-off, the text-host
 * registry, the rows it minted empty, and the pages its frames reveal. The
 * graph, the zoom root and the scope are the graph store's
 * (`stores/graph.store.ts`).
 *
 * The outline's rows are not stored. They are derived when read
 * (`outlineNodes`): what the page shows of the graph at default collapse (the
 * kit's `shownNodesOf`: the schema, or a scope's projection), opened
 * and closed by this store's `expansion`. So no reader can see the rows of
 * one snapshot beside another: there is one copy of the graph, and the rows
 * are a view of it.
 */
import { todayIn } from "@kb/calendar-kit";
import { useSyncExternalStore } from "react";
import { create } from "zustand";
import {
  browserHost,
  type CaretIntent,
  childInstanceKey,
  type EdnRunner,
  isRowOpen,
  placeOfInstance,
  type Expansion,
  type ExpansionChanges,
  type FamilyView,
  type FieldContextSource,
  type GraphChange,
  isProjectedInstance,
  isSysPrefixed,
  loadExpansion,
  logWarn,
  MAIN_OUTLINE_HOST,
  type NodeMap,
  nodeOfInstance,
  outlineInstanceKey,
  type OutlineNode,
  parentInstanceKey,
  type PageGraphState,
  type PageProjection,
  providedFrameViews,
  resolveProps,
  resolveVisibleProps,
  rowTextReadOnlyReason,
  saveExpansionChanges,
  type SchemaIndex,
  schemaOf,
  type ScopeSource,
  shownNodeId,
  shownNodesOf,
  showsAncestor,
  toast,
  WORKSPACE_ROOT_ID,
} from "@kb/ui-sdk";
import { isQueryNode, SYSTEM_IDS } from "@kb/model";
import {
  collectVisibleInstances,
  neighborVisibleInstance,
  type InstanceRef,
  queriesOf,
  subtreeOf,
  type VisibleInstance,
} from "./visible-instances.ts";
import type { FrameViewKey } from "@kb/views";
import {
  outlineHostIds,
  outlineHostOf,
  outlineHostOfInstance as walkHostOf,
} from "./outline-hosts";
import { openReferenceHolds, openReferenceKey } from "./open-references";
import { crumbsTo, type Crumb } from "./crumbs";

export type { VisibleInstance };

/** A query node's builder tabs: its conditions, or its EDN text. */
export type QueryTab = "conditions" | "edn";

/**
 * A query node's builder as this screen left it: the tab last used, and
 * whether a person opened or closed it. Absent members are the defaults the
 * builder derives (`query-builder/query-panel.tsx`).
 */
interface QueryBuilderScreen {
  readonly tab?: QueryTab;
  readonly open?: boolean;
}

interface ActivateOpts {
  /**
   * Viewport x-coordinate to preserve across vertical navigation (r1 D11).
   * Consumed by NodeContent after caret placement.
   */
  x?: number | null;
}

interface OutlineState {
  /** Which rows the reader opened or closed; the rows themselves are `outlineNodes()`. */
  expansion: Expansion;
  /** The references opened in place, each under its projected row's key (`open-references`): this tab's, never stored. */
  openReferences: ReadonlySet<string>;
  /** Data-layer node id currently being edited. */
  activeNodeId: string | null;
  /** Render-instance key for the active editor (disambiguates duplicates). */
  activeInstanceKey: string | null;
  /** The selection's head: the row a single selection is, and where a range's moving end is. */
  selectedNodeId: string | null;
  selectedInstanceKey: string | null;
  /**
   * The selection's anchor, the instance a range stays at while its head
   * moves (DESIGN-UI.md → Outline editor, "A selection is a range of rows");
   * null while the selection is one row.
   */
  selectionAnchorKey: string | null;
  /** The instance keys of every selected row: read per row, as `selectionOf` derives them. */
  selectedKeys: ReadonlySet<string>;
  /** The nodes of every selected row, in the order they are drawn (`PageEditor`). */
  selectedNodeIds: readonly string[];
  /**
   * Consumable placement command. Unlike the legacy cursor fields below this
   * is not editor state: ordinary store writes cannot make a host move.
   */
  pendingCaret: CaretIntent | null;
  /** Bumped on every activateNode so remounts re-place the caret. */
  focusSeq: number;
  /** Pending column-preservation target for the next activation (D11). */
  focusX: number | null;
  /** Session-minted transient node ids; empty ones prune on deactivate. */
  transientIds: Set<string>;

  activateNode: (id: string, cursorPos?: number, instanceKey?: string, opts?: ActivateOpts) => void;
  placeCaret: (instanceKey: string, at: CaretIntent["at"]) => void;
  consumeCaret: (instanceKey: string) => CaretIntent | null;
  registerTextHost: (instanceKey: string) => void;
  unregisterTextHost: (instanceKey: string) => void;
  deactivateNode: () => void;
  selectNode: (id: string | null, instanceKey?: string) => void;
  /**
   * Move the selection's head and keep its anchor: one row up or down, or to
   * the row at `instanceKey` (a Shift-click), in the outline the selection is in.
   */
  extendSelection: (to: "up" | "down" | { readonly instanceKey: string }) => void;
  /**
   * Select the range from `anchorId` to `headId`, each at its row in the
   * outline the selection is in: where a block lands after it moved, its
   * rows' instances being new.
   */
  selectRange: (anchorId: string, headId: string) => void;
  /** The selected rows, in the order they are drawn. */
  selectedRows: () => VisibleInstance[];
  /** Whether the row drawn at `instanceKey` is open (`isRowOpen`). */
  isOpen: (instanceKey: string) => boolean;
  /** Open or close the row drawn at `instanceKey`: a choice for its place. */
  toggleCollapse: (instanceKey: string) => void;
  /** Open the reference to `targetId` in the text of `sourceId` under its row, or close it. */
  toggleReference: (sourceId: string, targetId: string) => void;
  /**
   * Open the row at `instanceKey` and every row drawn under it (`subtreeOf`),
   * as the outline of host `host`, the one the key was pressed in, draws them.
   * Settles once the queries the subtree opens are answered and their rows
   * opened, or with nothing opened if the page has moved meanwhile.
   */
  expandSubtree: (instanceKey: string, host: string) => Promise<void>;
  /** Close the row at `instanceKey` and every row drawn under it, as `expandSubtree` finds them. */
  collapseSubtree: (instanceKey: string, host: string) => Promise<void>;
  /** Open every row the scope's outline draws, as it draws them all open. */
  expandAllInScope: () => Promise<void>;
  collapseAllInScope: () => Promise<void>;
  expandAncestors: (id: string) => void;
  /** Reveal `id` in the outline: expand its ancestors, zoom out if needed, edit its row. */
  jumpToNode: (id: string) => void;
  /** Pages revealed per frame in paginating view modes (frame id -> pages). */
  framePages: Record<string, number>;
  revealMorePages: (frameId: string) => void;
  /** The row each frame's detail view shows (frame id -> node id; DESIGN-UI.md → List with detail). */
  frameDetails: Readonly<Record<string, string>>;
  showDetail: (frameId: string, nodeId: string) => void;
  /** The day each frame's calendar is open at (frame id -> day; DESIGN-UI.md → Calendar). */
  frameDays: Readonly<Record<string, string>>;
  showDay: (frameId: string, day: string) => void;
  /** The day it is now, when pinned (a test, a story); null reads the browser's clock (`todayNow`). */
  today: string | null;
  /** Each query node's builder as this screen left it (query node id -> screen state). */
  queryBuilders: Readonly<Record<string, QueryBuilderScreen>>;
  setQueryBuilder: (queryNodeId: string, patch: QueryBuilderScreen) => void;
  /** The frame views provided, in their pickers' order (`stores/frame-views`). */
  frameViews: () => readonly FamilyView<FrameViewKey>[];
  /** The rows outline host `host` (the main pane's by default) draws, in render order. */
  getVisibleInstances: (host?: string) => VisibleInstance[];
  getVisibleNodes: () => string[];
  getPreviousVisibleInstance: (instanceKey: string) => VisibleInstance | null;
  getNextVisibleInstance: (instanceKey: string) => VisibleInstance | null;
  /** Where the walk reaches a row instance (its lane, DESIGN-UI.md → Lanes), or null. */
  instanceAt: (instanceKey: string) => VisibleInstance | null;
  getBreadcrumbs: () => Crumb[];
  /** Register a session-minted transient node id (auto-prune candidate). */
  markTransient: (ids: string | string[]) => void;
}

/** Data half of `OutlineState` — every member that is not a function. */
export type OutlineStateData = {
  [K in keyof OutlineState as OutlineState[K] extends (...args: never) => unknown
    ? never
    : K]: OutlineState[K];
};

export const initialOutlineState: OutlineStateData = {
  expansion: new Map(),
  openReferences: new Set(),
  framePages: {},
  frameDetails: {},
  frameDays: {},
  today: null,
  queryBuilders: {},
  activeNodeId: null,
  activeInstanceKey: null,
  selectedNodeId: null,
  selectedInstanceKey: null,
  selectionAnchorKey: null,
  selectedKeys: new Set<string>(),
  selectedNodeIds: [],
  pendingCaret: null,
  focusSeq: 0,
  focusX: null,
  transientIds: new Set<string>(),
};

/**
 * The day it is now: the store's pinned day, else the browser's, in its
 * zone. A calendar that has not been opened at a day shows this one.
 */
export function todayNow(): string {
  const pinned = useOutlineStore.getState().today;
  return pinned ?? todayIn(new Intl.DateTimeFormat().resolvedOptions().timeZone, Date.now());
}

/** The page's graph state now, as the shell holds it. */
function graphNow(): PageGraphState {
  return browserHost().graph.state();
}

/** Whether the graph serves `id` from its source file (`NodeIndex.isVirtual`). */
function virtualNow(id: string): boolean {
  return graphNow().index?.isVirtual(id) ?? false;
}

/** The schema the outline resolves against: the graph's (`schemaOf`). */
function schemaNow(): SchemaIndex {
  return schemaOf(graphNow());
}

/**
 * Whether the reader can still undo choosing `open` for the row at `place`:
 * the row can expand and `open` is not its default. A row the graph does not
 * hold now keeps its choice, so a row deleted and restored (an undo) comes
 * back as the reader left it. Storage keeps choices only for live nodes.
 */
function isUndoable(place: string, open: boolean, schema: SchemaIndex): boolean {
  const node = schema.get(nodeOfInstance(place));
  // A row's default is `node.collapsed`: a choice to open is one to change it.
  return node === undefined || (open === node.collapsed && isExpandableOutlineNode(node, schema));
}

/**
 * `expansion` with only the choices the reader can still undo
 * (`isUndoable`), so no row is held collapsed with no gesture to open it.
 * Every expansion the outline holds goes through it.
 */
function undoable(expansion: Expansion, schema: SchemaIndex): Expansion {
  let kept: Map<string, boolean> | null = null;
  for (const [id, open] of expansion) {
    if (isUndoable(id, open, schema)) continue;
    kept ??= new Map(expansion);
    kept.delete(id);
  }
  return kept ?? expansion;
}

/** What this tab changed from `before` to `after`: each id's choice now, or null where it has none. */
function changesOf(before: Expansion, after: Expansion): ExpansionChanges {
  const changes = new Map<string, boolean | null>();
  for (const [id, open] of after) if (before.get(id) !== open) changes.set(id, open);
  for (const id of before.keys()) if (!after.has(id)) changes.set(id, null);
  return changes;
}

/**
 * Whether storage keeps choice `open` for `id` over `schema`: a row's choice
 * the reader can undo, for a row the graph holds. The references opened in
 * place are this tab's alone, and so is the choice of a row the graph no
 * longer holds: the tab keeps it for an undo, and storage keeps it only once
 * the row is back.
 */
function isStored(place: string, open: boolean, schema: SchemaIndex): boolean {
  return schema.has(nodeOfInstance(place)) && isUndoable(place, open, schema);
}

/**
 * `next` made `undoable` over `after`, the schema of the graph it is held
 * against; `current` was held against `before`. A save writes only what
 * this tab decided, each row as storage keeps it of the result
 * (`isStored`): the rows `next` chose differently from `current` (the
 * reader's gestures, and the rows a graph move keeps open), and the rows
 * whose choice goes out of storage and back with the row, written with
 * every save. A choice `undoable` drops because the graph moved is not
 * written: another tab may see that row differently, and a load drops it
 * again while it still cannot be undone. The changes are applied onto
 * storage's current expansion, never a snapshot of this tab's, so another
 * tab's choices survive.
 */
function keptExpansion(
  current: Expansion,
  before: SchemaIndex,
  next: Expansion,
  after: SchemaIndex,
): Expansion {
  const kept = undoable(next, after);
  const decided = new Set(changesOf(current, next).keys());
  const gone: string[] = [];
  for (const place of kept.keys()) {
    const id = nodeOfInstance(place);
    if (!after.has(id)) gone.push(place);
    else if (!before.has(id)) decided.add(place);
  }
  for (const place of gone) if (before.has(nodeOfInstance(place))) decided.add(place);
  if (decided.size === 0) return kept;
  const places = [...new Set([...decided, ...gone])];
  const placeOfId = placeOfIdIn(after);
  const previousPlaceOfId = placeOfIdIn(before);
  saveExpansionChanges(
    new Map(
      places.map((place) => {
        const open = kept.get(place);
        return [place, open !== undefined && isStored(place, open, after) ? open : null] as const;
      }),
    ),
    (id) => (after.has(id) ? placeOfId(id) : previousPlaceOfId(id)),
  );
  return kept;
}

/** A node's place in the outline's tree over `nodes`: where a choice an older build stored by id stands. */
function placeOfIdIn(nodes: NodeMap): (id: string) => string {
  return (id) => placeOfInstance(outlineInstanceKey(id, nodes));
}

/** The references of `open` whose rows' text still names them (`openReferenceHolds`). */
function heldReferences(open: ReadonlySet<string>, schema: SchemaIndex): ReadonlySet<string> {
  const held = [...open].filter((key) => openReferenceHolds(key, schema));
  return held.length === open.size ? open : new Set(held);
}

/**
 * The rows above `id` in the outline's tree that `expansion` shows closed,
 * each as a choice to open its place.
 */
function ancestorsToOpen(
  rows: NodeMap,
  id: string,
  expansion: Expansion,
): Array<readonly [string, boolean]> {
  const open: Array<readonly [string, boolean]> = [];
  let current: OutlineNode | undefined = rows.get(id);
  while (current !== undefined && current.parentId !== null) {
    const parent = rows.get(current.parentId);
    if (!parent) break;
    const key = outlineInstanceKey(parent.id, rows);
    if (!isRowOpen(parent, key, expansion)) open.push([placeOfInstance(key), true]);
    current = parent;
  }
  return open;
}

/** `expansion` with `choices` recorded in it (as given; `undoable` decides what stays). */
function withChoices(
  expansion: Expansion,
  choices: Iterable<readonly [string, boolean]>,
): Expansion {
  let next: Map<string, boolean> | null = null;
  for (const [id, open] of choices) {
    if (expansion.get(id) === open) continue;
    next ??= new Map(expansion);
    next.set(id, open);
  }
  return next ?? expansion;
}

/** `schema` is the map field definitions are read from (`lib/schema.ts`). */
function isExpandableOutlineNode(node: OutlineNode, schema: SchemaIndex): boolean {
  if (node.children.length > 0) return true;
  if (isQueryNode(node)) return true;
  return resolveProps(node, schema).length > 0;
}

/**
 * The outline's rows over `graph`: what the page shows of it (`shownNodesOf`),
 * each node at its default collapse. Whether a row is open is its place's
 * (`isRowOpen`), so expanding builds nothing here.
 */
function rowsOf(graph: ScopeSource): NodeMap {
  return shownNodesOf(graph);
}

/**
 * The outline's rows now. The same value until the graph or its scope
 * moves; a row keeps its object for as long as what it shows does.
 */
export function outlineNodes(): NodeMap {
  return rowsOf(graphNow());
}

/** Listen for every change `outlineNodes` can follow: the graph's and this store's. */
function subscribeOutline(listener: () => void): () => void {
  const fromGraph = browserHost().graph.subscribe(listener);
  const fromOutline = useOutlineStore.subscribe(listener);
  return () => {
    fromGraph();
    fromOutline();
  };
}

/** The outline's rows, read by this component: it re-renders when they change. */
export function useOutlineNodes(): NodeMap {
  return useSyncExternalStore(subscribeOutline, outlineNodes, outlineNodes);
}

/** One row of the outline: this component re-renders when that row changes. */
export function useOutlineNode(id: string | null): OutlineNode | undefined {
  const read = () => (id === null ? undefined : outlineNodes().get(id));
  return useSyncExternalStore(subscribeOutline, read, read);
}

/** The selection's members, as `OutlineState` holds them. */
type Selection = Pick<
  OutlineStateData,
  | "selectedNodeId"
  | "selectedInstanceKey"
  | "selectionAnchorKey"
  | "selectedKeys"
  | "selectedNodeIds"
>;

/**
 * The selection whose head is `nodeId` at `instanceKey` and whose anchor is
 * `anchorKey`: every row from one to the other in `rows`, the order the
 * outline draws them. An anchor that is the head, or that `rows` does not
 * draw, makes it the head alone.
 */
function selectionOf(
  nodeId: string | null,
  instanceKey: string | null,
  anchorKey: string | null = null,
  rows: () => readonly VisibleInstance[] = () => [],
): Selection {
  const one = (): Selection => ({
    selectedNodeId: nodeId,
    selectedInstanceKey: nodeId === null ? null : instanceKey,
    selectionAnchorKey: null,
    selectedKeys: nodeId === null || instanceKey === null ? new Set() : new Set([instanceKey]),
    selectedNodeIds: nodeId === null ? [] : [nodeId],
  });
  if (nodeId === null || instanceKey === null || anchorKey === null || anchorKey === instanceKey)
    return one();
  const drawn = rows();
  const head = drawn.findIndex((row) => row.instanceKey === instanceKey);
  const anchor = drawn.findIndex((row) => row.instanceKey === anchorKey);
  if (head < 0 || anchor < 0) return one();
  const range = drawn.slice(Math.min(head, anchor), Math.max(head, anchor) + 1);
  return {
    selectedNodeId: nodeId,
    selectedInstanceKey: instanceKey,
    selectionAnchorKey: anchorKey,
    selectedKeys: new Set(range.map((row) => row.instanceKey)),
    selectedNodeIds: range.map((row) => row.nodeId),
  };
}

/** No row edited, none selected, no caret pending. */
const NO_FOCUS = {
  activeNodeId: null,
  activeInstanceKey: null,
  ...selectionOf(null, null),
} as const;

/** The outline's rows as an activation reads them: the nodes, their schema, the reader's expansion. */
interface RowsNow {
  readonly nodes: NodeMap;
  readonly schema: SchemaIndex;
  readonly expansion: Expansion;
}

/** The outline's rows now (`RowsNow`). */
function rowsNow(): RowsNow {
  return {
    nodes: outlineNodes(),
    schema: schemaNow(),
    expansion: useOutlineStore.getState().expansion,
  };
}

/**
 * The instance to activate `id` at: the one named, else under `working` (or its
 * parent row) when `id` is a child of the node shown there — so Enter or `o`
 * under an expanded contextual reference focuses the new row under that
 * reference, wherever it is drawn (under a query result too), instead of
 * jumping to the target's canonical path — else its row in the outline being
 * worked in (the host of `working`, the current selection).
 */
function resolveActivateKey(
  id: string,
  instanceKey: string | undefined,
  working: string | null,
  { nodes, schema, expansion }: RowsNow,
): string {
  if (instanceKey !== undefined) return instanceKey;
  const parentId = nodes.get(id)?.parentId ?? null;
  if (parentId !== null && working !== null) {
    const workingNode = nodes.get(nodeOfInstance(working));
    if (
      workingNode !== undefined &&
      isRowOpen(workingNode, working, expansion) &&
      shownNodeId(workingNode) === parentId &&
      !showsAncestor(working, workingNode, schema)
    ) {
      return childInstanceKey(working, id);
    }
    const parentKey = parentInstanceKey(working);
    const parentNode = parentKey === null ? undefined : nodes.get(nodeOfInstance(parentKey));
    if (parentKey !== null && parentNode !== undefined && shownNodeId(parentNode) === parentId) {
      return childInstanceKey(parentKey, id);
    }
  }
  return outlineInstanceKey(id, nodes, walkHostOf(working));
}

/**
 * Tana-style transient pruning (r1 §3.3): a session-minted node that never
 * received content and carries no structure is silently removed when focus
 * moves elsewhere. Pre-existing nodes are never pruned (data compat).
 */
function isPrunableTransient(
  node: OutlineNode | undefined,
  id: string,
  transientIds: Set<string>,
  schema: SchemaIndex,
): boolean {
  if (!node || !transientIds.has(id)) return false;
  if (isSysPrefixed(id)) return false;
  if (node.text !== "") return false;
  if (node.children.length > 0) return false;
  // Content is a value the node holds — hidden or not, since pruning deletes
  // it — never an empty slot a supertag templates. Tags alone are not content.
  return !resolveVisibleProps(node, schema, { showDebugFields: true }).some(
    (prop) => prop.empty !== true && prop.fieldId !== SYSTEM_IDS.typeField,
  );
}

export const useOutlineStore = create<OutlineState>()((set, get) => {
  /**
   * FocusRegistry's mounted half. Visibility is checked synchronously during
   * activation; this set closes the final race between projection and React
   * mounting so an orphaned active id cannot eat keyboard input.
   */
  const mountedTextHosts = new Set<string>();

  function fallBackFromMissingHost(instanceKey: string): void {
    const active = get();
    if (active.activeInstanceKey !== instanceKey || mountedTextHosts.has(instanceKey)) return;
    if (import.meta.env.DEV) {
      logWarn(`kb: active text host did not mount: ${instanceKey}`);
    }
    set({
      activeNodeId: null,
      activeInstanceKey: null,
      pendingCaret: null,
    });
  }

  /** Record the reader's open (true) or closed (false) choice for each row named. */
  function choose(choices: Iterable<readonly [string, boolean]>): void {
    const current = get().expansion;
    const next = withChoices(current, choices);
    if (next === current) return;
    const schema = schemaNow();
    set({ expansion: keptExpansion(current, schema, next, schema) });
  }

  /** Open (true) or close (false) each of `rows` that can expand and is not so already. */
  function openRows(rows: Iterable<InstanceRef>, open: boolean): void {
    const nodes = outlineNodes();
    const schema = schemaNow();
    const { expansion } = get();
    const choices: Array<readonly [string, boolean]> = [];
    for (const { nodeId, instanceKey } of rows) {
      const node = nodes.get(nodeId);
      if (
        node !== undefined &&
        isRowOpen(node, instanceKey, expansion) !== open &&
        isExpandableOutlineNode(node, schema)
      ) {
        choices.push([placeOfInstance(instanceKey), open]);
      }
    }
    choose(choices);
  }

  return {
    ...initialOutlineState,

    activateNode: (id, cursorPos, instanceKey, opts) => {
      if (!outlineNodes().has(id)) return;
      // A row whose text cannot be written is read-only at the DOM level:
      // activation degrades to selection so no caret ever enters it (r1 D20).
      // `rowTextReadOnlyReason` owns which rows those are — a node read from
      // its source file, and a contextual reference whose target is gone.
      if (rowTextReadOnlyReason(id, outlineNodes().get(id), schemaNow(), virtualNow) !== null) {
        // The outline being worked in is the one the focus is leaving.
        const roKey = resolveActivateKey(id, instanceKey, get().selectedInstanceKey, rowsNow());
        pruneOutgoingTransient(id);
        set({
          ...selectionOf(id, roKey),
          activeNodeId: null,
          activeInstanceKey: null,
        });
        return;
      }
      // Reveal the full parent chain before validating the instance. Creation,
      // indent, and palette navigation therefore cannot focus a hidden row.
      get().expandAncestors(id);
      const revealed = get();
      const key = resolveActivateKey(id, instanceKey, revealed.selectedInstanceKey, rowsNow());
      // Projected instances (query rows, canvas cards) are drawn by the component
      // that mounts them, so their exact
      // visibility is only knowable once it mounts. The mounted-host
      // half of the registry below validates them after React commits.
      if (
        !isProjectedInstance(key) &&
        !revealed.getVisibleInstances(walkHostOf(key)).some((item) => item.instanceKey === key)
      ) {
        if (import.meta.env.DEV) logWarn(`kb: refused unreachable focus target: ${key}`);
        toast("That node is not visible in this outline");
        return;
      }
      // Tana transient rule: an empty session-minted node prunes the moment
      // focus moves to a different row (r1 §3.3).
      pruneOutgoingTransient(id);
      const at: CaretIntent["at"] =
        opts?.x !== null && opts?.x !== undefined ? { x: opts.x } : (cursorPos ?? 0);
      set({
        activeNodeId: id,
        activeInstanceKey: key,
        ...selectionOf(id, key),
        pendingCaret: { instanceKey: key, at },
        focusX: null,
      });
      if (typeof window !== "undefined") {
        // Let React finish a full paint cycle (including a virtualized list
        // remount) before treating the focus target as unavailable.
        window.setTimeout(() => fallBackFromMissingHost(key), 250);
      }
    },

    placeCaret: (instanceKey, at) => {
      const st = get();
      if (st.activeInstanceKey !== instanceKey) return;
      set({ pendingCaret: { instanceKey, at } });
    },

    consumeCaret: (instanceKey) => {
      const intent = get().pendingCaret;
      if (!intent || intent.instanceKey !== instanceKey) return null;
      set({ pendingCaret: null });
      return intent;
    },

    registerTextHost: (instanceKey) => {
      mountedTextHosts.add(instanceKey);
    },

    unregisterTextHost: (instanceKey) => {
      mountedTextHosts.delete(instanceKey);
      if (typeof window !== "undefined") {
        window.setTimeout(() => fallBackFromMissingHost(instanceKey), 250);
      }
    },

    deactivateNode: () => {
      pruneOutgoingTransient(null);
      set({ activeNodeId: null, activeInstanceKey: null, pendingCaret: null });
    },

    selectNode: (id, instanceKey) => {
      if (id === null) {
        pruneOutgoingTransient(null);
        set({ ...NO_FOCUS, pendingCaret: null });
        return;
      }
      const nodes = outlineNodes();
      const { selectedInstanceKey } = get();
      if (!nodes.has(id)) return;
      // The outline being worked in is the one the focus is leaving.
      const key = resolveActivateKey(id, instanceKey, selectedInstanceKey, rowsNow());
      pruneOutgoingTransient(id);
      set({
        ...selectionOf(id, key),
        activeNodeId: null,
        activeInstanceKey: null,
        pendingCaret: null,
      });
    },

    extendSelection: (to) => {
      const st = get();
      // A row being edited is where a Shift-click's range starts; with
      // nothing selected, the row clicked is.
      const fromKey =
        st.activeInstanceKey ??
        st.selectedInstanceKey ??
        (typeof to === "object" ? to.instanceKey : null);
      if (fromKey === null) return;
      const rows = st.getVisibleInstances(walkHostOf(fromKey));
      const at = rows.findIndex((row) => row.instanceKey === fromKey);
      const head =
        typeof to === "object"
          ? rows.find((row) => row.instanceKey === to.instanceKey)
          : rows[at + (to === "up" ? -1 : 1)];
      if (head === undefined || at < 0) return;
      pruneOutgoingTransient(head.nodeId);
      set({
        ...selectionOf(head.nodeId, head.instanceKey, st.selectionAnchorKey ?? fromKey, () => rows),
        activeNodeId: null,
        activeInstanceKey: null,
        pendingCaret: null,
      });
    },

    selectRange: (anchorId, headId) => {
      const nodes = outlineNodes();
      const working = get().selectedInstanceKey;
      if (!nodes.has(anchorId) || !nodes.has(headId)) return;
      const headKey = resolveActivateKey(headId, undefined, working, rowsNow());
      const anchorKey = resolveActivateKey(anchorId, undefined, working, rowsNow());
      set({
        ...selectionOf(headId, headKey, anchorKey, () =>
          get().getVisibleInstances(walkHostOf(headKey)),
        ),
        activeNodeId: null,
        activeInstanceKey: null,
        pendingCaret: null,
      });
    },

    selectedRows: () => {
      const { selectedInstanceKey, selectedKeys } = get();
      if (selectedInstanceKey === null) return [];
      return get()
        .getVisibleInstances(walkHostOf(selectedInstanceKey))
        .filter((row) => selectedKeys.has(row.instanceKey));
    },

    isOpen: (instanceKey) => {
      const node = outlineNodes().get(nodeOfInstance(instanceKey));
      return node !== undefined && isRowOpen(node, instanceKey, get().expansion);
    },

    toggleCollapse: (instanceKey) => {
      const node = outlineNodes().get(nodeOfInstance(instanceKey));
      if (!node || !isExpandableOutlineNode(node, schemaNow())) return;
      choose([[placeOfInstance(instanceKey), !isRowOpen(node, instanceKey, get().expansion)]]);
    },

    toggleReference: (sourceId, targetId) => {
      const key = openReferenceKey(sourceId, targetId);
      const open = new Set(get().openReferences);
      if (!open.delete(key)) open.add(key);
      set({ openReferences: open });
    },

    expandSubtree: async (instanceKey, host) => {
      const rows = await subtreeDrawnOpen(instanceKey, host);
      if (rows !== null) openRows(rows, true);
    },

    collapseSubtree: async (instanceKey, host) => {
      const rows = await subtreeDrawnOpen(instanceKey, host);
      if (rows !== null) openRows(rows, false);
    },

    expandAllInScope: async () => {
      const rows = await scopeDrawnOpen();
      if (rows !== null) openRows(rows, true);
    },

    collapseAllInScope: async () => {
      const rows = await scopeDrawnOpen();
      if (rows !== null) openRows(rows, false);
    },

    expandAncestors: (id) => choose(ancestorsToOpen(outlineNodes(), id, get().expansion)),

    jumpToNode: revealNode,

    frameViews: providedFrameViews,

    getVisibleInstances: (host = MAIN_OUTLINE_HOST) =>
      visibleInstancesOf(host, graphNow(), get().expansion),

    setQueryBuilder: (queryNodeId, patch) =>
      set((s) => ({
        queryBuilders: {
          ...s.queryBuilders,
          [queryNodeId]: { ...s.queryBuilders[queryNodeId], ...patch },
        },
      })),
    revealMorePages: (frameId) =>
      set((s) => ({
        framePages: {
          ...s.framePages,
          [frameId]: (s.framePages[frameId] ?? 1) + 1,
        },
      })),
    showDetail: (frameId, nodeId) =>
      set((s) =>
        s.frameDetails[frameId] === nodeId
          ? s
          : { frameDetails: { ...s.frameDetails, [frameId]: nodeId } },
      ),

    showDay: (frameId, day) =>
      set((s) =>
        s.frameDays[frameId] === day ? s : { frameDays: { ...s.frameDays, [frameId]: day } },
      ),

    getVisibleNodes: () =>
      get()
        .getVisibleInstances()
        .map((i) => i.nodeId),

    getPreviousVisibleInstance: (instanceKey) =>
      neighborVisibleInstance(get().getVisibleInstances(walkHostOf(instanceKey)), instanceKey, -1),

    getNextVisibleInstance: (instanceKey) =>
      neighborVisibleInstance(get().getVisibleInstances(walkHostOf(instanceKey)), instanceKey, 1),

    instanceAt: (instanceKey) =>
      get()
        .getVisibleInstances(walkHostOf(instanceKey))
        .find((instance) => instance.instanceKey === instanceKey) ?? null,

    getBreadcrumbs: () => {
      const { rootNodeId, homeRootId } = graphNow();
      return crumbsTo(rootNodeId, homeRootId, outlineNodes(), browserHost().schema());
    },

    markTransient: (ids) => {
      const list = Array.isArray(ids) ? ids : [ids];
      set((s) => {
        const next = new Set(s.transientIds);
        for (const id of list) next.add(id);
        return { transientIds: next };
      });
    },
  };
});

/**
 * Reveal `id` in the outline: expand its ancestors, zoom out if needed, edit
 * its row. The store's `jumpToNode` and the projection's `reveal` are this
 * one function.
 */
function revealNode(id: string): void {
  const outline = useOutlineStore.getState;
  // Where the jump would land, checked before anything moves: the graph
  // state that shows `id` (the scope left if need be), its ancestors open.
  const at = id === WORKSPACE_ROOT_ID ? null : browserHost().graph.reached(id);
  if (at === null) return;
  const expansion = undoable(
    withChoices(outline().expansion, ancestorsToOpen(rowsOf(at), id, outline().expansion)),
    schemaOf(at),
  );
  const shows = (rootNodeId: string) =>
    visibleInstancesOf(MAIN_OUTLINE_HOST, { ...at, rootNodeId }, expansion).some(
      (row) => row.nodeId === id,
    );
  // The row being edited is shown where it is edited: the page stays put,
  // so going home never prunes the row the jump is going to.
  const editing = outline().activeNodeId === id;
  const goesHome = !editing && !shows(at.rootNodeId);
  if (goesHome && !shows(at.homeRootId)) {
    toast("That node is not visible in this outline");
    return;
  }
  browserHost().graph.reach(id);
  outline().expandAncestors(id);
  if (goesHome) browserHost().zoomHome();
  // The row being edited keeps the instance it is edited at.
  const key =
    (editing ? outline().activeInstanceKey : null) ?? outlineInstanceKey(id, outlineNodes());
  outline().activateNode(id, 0, key);
  // scroll into view after paint — instance key beats bare nodeId
  requestAnimationFrame(() => {
    document
      .querySelector(`[data-instance-key="${CSS.escape(key)}"]`)
      ?.scrollIntoView({ block: "center", behavior: "smooth" });
  });
}

/** The selected and active rows that still have a row in `nodes`. */
function keptIds(
  prev: OutlineStateData,
  nodes: NodeMap,
): Pick<OutlineStateData, "selectedNodeId" | "activeNodeId"> {
  return {
    selectedNodeId:
      prev.selectedNodeId !== null && nodes.has(prev.selectedNodeId) ? prev.selectedNodeId : null,
    activeNodeId:
      prev.activeNodeId !== null && nodes.has(prev.activeNodeId) ? prev.activeNodeId : null,
  };
}

/** The focus that survives a graph move to `nodes`: what still has a row there. */
function keptFocus(prev: OutlineStateData, nodes: NodeMap): Partial<OutlineStateData> {
  const { selectedNodeId, activeNodeId } = keptIds(prev, nodes);
  const kept = [...prev.transientIds].filter((id) => nodes.has(id));
  return {
    // A range is drawn again over the moved graph (`follow`); here it is its head.
    ...selectionOf(selectedNodeId, prev.selectedInstanceKey),
    selectionAnchorKey: selectedNodeId !== null ? prev.selectionAnchorKey : null,
    activeNodeId,
    activeInstanceKey: activeNodeId !== null ? prev.activeInstanceKey : null,
    // The caret is the active row's: it goes with it.
    pendingCaret: activeNodeId !== null ? prev.pendingCaret : null,
    transientIds: kept.length === prev.transientIds.size ? prev.transientIds : new Set(kept),
  };
}

/**
 * The expansion kept across a move from `prev` to `next`: a row shown open
 * stays open when the move makes its node's default collapsed — it gained
 * children or fields while the reader looked at it. The choice is set at
 * each place an outline on screen draws the node without one.
 */
function keptOpen(expansion: Expansion, prev: PageGraphState, next: PageGraphState): Expansion {
  const from = shownNodesOf(prev);
  const flipped = new Set<string>();
  for (const [id, node] of shownNodesOf(next)) {
    if (node.collapsed && from.get(id)?.collapsed === false) flipped.add(id);
  }
  if (flipped.size === 0) return expansion;
  let kept: Map<string, boolean> | null = null;
  for (const host of outlineHostIds()) {
    for (const row of visibleInstancesOf(host, next, expansion)) {
      const place = placeOfInstance(row.instanceKey);
      if (!flipped.has(row.nodeId) || expansion.has(place)) continue;
      kept ??= new Map(expansion);
      kept.set(place, true);
    }
  }
  return kept ?? expansion;
}

/** The focus each move other than a fresh load keeps: what still has a row, or none at a scope. */
const KEPT_FOCUS: Record<
  Exclude<GraphChange, "load">,
  (prev: OutlineStateData, to: NodeMap) => Partial<OutlineStateData>
> = {
  tx: keptFocus,
  resync: keptFocus,
  sync: keptIds,
  scope: () => NO_FOCUS,
};

/**
 * Move the outline's own state for a graph move from `prev` to `next`, before
 * the graph store moves. A fresh load keeps nothing and reads the expansion
 * from storage. Every other move keeps the expansion (`keptOpen`) and the
 * focus its kind keeps (`KEPT_FOCUS`). Either way the expansion is made
 * `undoable` against `next`. What it keeps is valid against both states: the
 * focus kept is on rows `next` still shows and `prev` showed, and the rows it
 * keeps open already showed open in `prev`.
 */
function follow(change: GraphChange, prev: PageGraphState, next: PageGraphState): void {
  const outline = useOutlineStore.getState();
  const schema = schemaOf(next);
  if (change === "load") {
    useOutlineStore.setState({
      // A load writes nothing: storage is read, as every tab left it.
      expansion: undoable(loadExpansion(placeOfIdIn(shownNodesOf(next))), schema),
      openReferences: new Set<string>(),
      ...NO_FOCUS,
      pendingCaret: null,
      transientIds: new Set<string>(),
    });
    return;
  }
  const to = shownNodesOf(next);
  const open = keptOpen(outline.expansion, prev, next);
  const expansion = keptExpansion(outline.expansion, schemaOf(prev), open, schema);
  const kept = KEPT_FOCUS[change](outline, to);
  const focus = { ...outline, ...kept };
  useOutlineStore.setState({
    expansion,
    openReferences: heldReferences(outline.openReferences, schema),
    ...kept,
    // A range keeps its anchor and its head where the moved graph still
    // draws both, and the rows between them are read again.
    ...selectionOf(focus.selectedNodeId, focus.selectedInstanceKey, focus.selectionAnchorKey, () =>
      focus.selectedInstanceKey === null
        ? []
        : visibleInstancesOf(walkHostOf(focus.selectedInstanceKey), next, expansion),
    ),
  });
}

/**
 * The outgoing active row, when it is an empty session transient (r1 §3.3
 * auto-prune) as `graph` shows it: the row to prune as the focus moves.
 * nextId = incoming focus target; null when focus leaves the outline
 * entirely.
 */
function outgoingTransient(nextId: string | null, graph: PageGraphState): string | null {
  const st = useOutlineStore.getState();
  const out = st.activeNodeId;
  if (out === null || out === nextId) return null;
  const node = rowsOf(graph).get(out);
  return isPrunableTransient(node, out, st.transientIds, schemaOf(graph)) ? out : null;
}

/**
 * Prune the outgoing transient (`outgoingTransient`) as the focus moves to
 * `nextId`. The removal is a graph write like any other, so the outline
 * follows it as it follows every write.
 */
function pruneOutgoingTransient(nextId: string | null): void {
  const out = outgoingTransient(nextId, graphNow());
  if (out !== null) browserHost().graph.drop(out);
}

/** The rows outline host `host` draws over `graph`, opened by `expansion`. */
function visibleInstancesOf(
  host: string,
  graph: PageGraphState,
  expansion: Expansion,
): VisibleInstance[] {
  return instancesOver(host, graph, rowsOf(graph), expansion, runnerOf(graph));
}

/** The query answers a walk over `graph` reads: the ones the page has. */
function runnerOf(graph: PageGraphState): EdnRunner | null {
  return graph.queries?.runner() ?? null;
}

/**
 * The rows outline host `host` draws of `nodes`, the rows of `graph` opened
 * by `expansion`, with query results as `run` answers them: the walk itself,
 * over rows a caller may open as it tries them (`rowsDrawnOpen`) without
 * moving the outline's own (`rowsOf`).
 */
function instancesOver(
  host: string,
  graph: PageGraphState,
  nodes: NodeMap,
  expansion: Expansion,
  run: EdnRunner | null,
): VisibleInstance[] {
  const outline = outlineHostOf(host);
  if (outline === undefined) return [];
  const views = providedFrameViews().map((view) => view.key);
  return collectVisibleInstances(
    outline.root ?? graph.rootNodeId,
    {
      nodes,
      schema: schemaOf(graph),
      run,
      views,
      chain: outline.chain,
      pages: useOutlineStore.getState().framePages,
      expansion,
      references: useOutlineStore.getState().openReferences,
      details: useOutlineStore.getState().frameDetails,
      days: useOutlineStore.getState().frameDays,
      today: todayNow(),
    },
    host,
  );
}

/** What a subtree step picks from a walk: its rows, and the queries it waits for. */
interface Picked {
  readonly rows: readonly VisibleInstance[];
  /** The queries whose answers the step waits for, of those the walk ran; null for every one. */
  readonly awaits: ReadonlySet<string> | null;
}

/** Where a page stands, which a subtree step's rows belong to. */
function pageOf(host: string): readonly unknown[] {
  const graph = graphNow();
  return [graph.rootNodeId, graph.ontologyId, outlineHostOf(host)];
}

/**
 * The rows outline host `host` would draw with every row that
 * `pick` takes from its walk open: the walk, as the outline draws it
 * (`collectVisibleInstances`: query results, references opened in place, a
 * frame's view), tried again with each picked row that is closed opened,
 * until none is. A query's results are its answer, so the walk is read until
 * every query `pick` waits for is answered (`settle`), a query no row had
 * drawn included. Null when the page has moved by then: the rows are that
 * page's, and opening them would land on another.
 */
async function rowsDrawnOpen(
  host: string,
  pick: (rows: readonly VisibleInstance[], nodes: NodeMap, schema: SchemaIndex) => Picked,
): Promise<readonly VisibleInstance[] | null> {
  const page = pageOf(host);
  const read = (run: EdnRunner | null): Picked => drawnOpen(host, graphNow(), run, pick);
  const queries = graphNow().queries;
  const picked = queries === null ? read(null) : await queries.settle(read, ({ awaits }) => awaits);
  const now = pageOf(host);
  if (now.some((at, i) => at !== page[i])) return null;
  return picked.rows;
}

/** One read of `rowsDrawnOpen`, with query results as `run` answers them now. */
function drawnOpen(
  host: string,
  graph: PageGraphState,
  run: EdnRunner | null,
  pick: (rows: readonly VisibleInstance[], nodes: NodeMap, schema: SchemaIndex) => Picked,
): Picked {
  const schema = schemaOf(graph);
  let expansion = useOutlineStore.getState().expansion;
  for (;;) {
    const nodes = shownNodesOf(graph);
    const picked = pick(instancesOver(host, graph, nodes, expansion, run), nodes, schema);
    const closed = picked.rows.flatMap(
      ({ nodeId, instanceKey }): Array<readonly [string, boolean]> => {
        const node = nodes.get(nodeId);
        return node !== undefined &&
          !isRowOpen(node, instanceKey, expansion) &&
          isExpandableOutlineNode(node, schema)
          ? [[placeOfInstance(instanceKey), true]]
          : [];
      },
    );
    const next = withChoices(expansion, closed);
    if (next === expansion) return picked;
    expansion = next;
  }
}

/**
 * The rows of the subtree at row `instanceKey`, as the outline of host `host`
 * draws it all open (`subtreeOf`). It waits only for the queries drawn inside it.
 */
function subtreeDrawnOpen(
  instanceKey: string,
  host: string,
): Promise<readonly VisibleInstance[] | null> {
  return rowsDrawnOpen(host, (walk, nodes, schema) => {
    const rows = subtreeOf(walk, instanceKey, nodes);
    return { rows, awaits: queriesOf(rows, nodes, schema) };
  });
}

/** Every row of the scope's outline, as it draws them all open: every query it runs is in it. */
function scopeDrawnOpen(): Promise<readonly VisibleInstance[] | null> {
  return rowsDrawnOpen(MAIN_OUTLINE_HOST, (rows) => ({ rows, awaits: null }));
}

/**
 * Where navigation lands the focus, before the page stands at `to`: nowhere
 * at home, and at a zoom on the first row under `to.rootNodeId`. The zoom
 * root is the header, not a row, so it cannot hold the selection: row keys
 * and ⌘K would anchor on nothing visible.
 */
function arrive(at: "zoom" | "home", to: PageGraphState): void {
  if (at === "home") {
    useOutlineStore.setState({ ...NO_FOCUS });
    return;
  }
  const { expansion } = useOutlineStore.getState();
  const first = visibleInstancesOf(MAIN_OUTLINE_HOST, to, expansion)[0] ?? null;
  useOutlineStore.setState({
    activeNodeId: null,
    activeInstanceKey: null,
    ...selectionOf(first?.nodeId ?? null, first?.instanceKey ?? null),
  });
}

/**
 * A control inside the outline that is not a row took the keyboard (a
 * field's value, a live preview's controls): the outline lets go of its
 * selected and its edited row, so the selection keymap and the row's
 * editing keys stop acting on keys meant for that control.
 */
export function releaseOutlineKeyboard(): void {
  const s = useOutlineStore.getState();
  if (s.selectedNodeId !== null || s.activeNodeId !== null) s.selectNode(null);
}

/**
 * The outline as the projection the page stands in: installed by the outline
 * plugin while it is loaded (`PageProjectionService`), beside this store as
 * the page's editor (`PageEditorService`).
 */
export const outlineProjection: PageProjection = {
  follow,
  leave: (from) => outgoingTransient(null, from),
  arrive,
  subscribe: useOutlineStore.subscribe,
  rows: rowsOf,
  reveal: revealNode,
};

/**
 * This outline's rows with the graph they project and its query answers, read now:
 * what a step that knows a row only by id resolves against (`rowTextOf`,
 * `fieldContextOf`).
 */
export function outlineSource(): FieldContextSource {
  const graph = graphNow();
  return { schema: schemaOf(graph), queries: graph.queries, nodes: outlineNodes() };
}
