/**
 * Render-order visible outline instances (tree + projected rows).
 *
 * Row order is not decided here — every frame's rows come from
 * {@link frameRows}, the function the renderers call, as each frame's view
 * ({@link frameViewOf}) lays them out. This walk only assigns instance keys and recurses,
 * and says which lane a row sits in when its frame lays rows out as lanes.
 */
import {
  childInstanceKey,
  type Expansion,
  frameRows,
  type FrameView,
  frameViewOf,
  hasText,
  isProjectedRow,
  type EdnRunner,
  type GroupSteps,
  MAIN_OUTLINE_HOST,
  type NodeMap,
  outlineInstanceKey,
  type OutlineNode,
  projectedRowKey,
  resultNodeIds,
  type SchemaIndex,
  shownNode,
  showsAncestor,
  type SlotChain,
  slotLink,
  slotRenders,
} from "@kb/ui-sdk";
import { isQueryNode, queryDefOf } from "@kb/model";
import { detailRowOf, laysOutLanes, projectsRows, type FrameViewKey } from "@kb/views";
import { openReferenceKey, openReferencesOf, opensInPlace } from "./open-references";

/** A row the walk reaches: which node, and under which instance. */
export interface InstanceRef {
  nodeId: string;
  instanceKey: string;
}

/**
 * The lane a row sits in, when its frame lays rows out as lanes
 * (DESIGN-UI.md → Lanes): the lane's head, and the heads of the lanes
 * before and after it. A head's own lane names itself.
 */
export interface VisibleLane {
  head: InstanceRef;
  before: InstanceRef | null;
  after: InstanceRef | null;
}

/**
 * The groups beside a row's own, when its frame groups rows by a field
 * (DESIGN-UI.md → Groups): where ⌘⇧← and ⌘⇧→ move it, by `fieldId`.
 */
interface VisibleGroup extends GroupSteps {
  /** The frame the row is laid out in, whose calendar opens at a step's `opens`. */
  readonly frameId: string;
  readonly fieldId: string;
}

export type VisibleInstance = InstanceRef & {
  /** Set when the row sits in a lane; the innermost lane when lanes nest. */
  lane?: VisibleLane;
  /** Set when the row sits in a group it can move out of by key. */
  group?: VisibleGroup;
};

/** Pages revealed per frame in paginating modes, keyed by frame node id. */
type FramePagesMap = Readonly<Record<string, number>>;

/** What a walk carries all the way down: the graph, the query answers, the
 * per-frame page counts, and the list it appends to. */
interface WalkContext {
  nodes: NodeMap;
  schema: SchemaIndex;
  /**
   * The answers a query node's results are read from: the same ones its
   * rendered results show (`useQueryRows`), so a walk offers the rows the
   * page draws.
   */
  run: EdnRunner | null;
  /** The frame views provided, which a frame's props resolve against. */
  views: readonly FrameViewKey[];
  /** The slots around the outline's root frame, as its host renders it (`useSlotChain`). */
  chain: SlotChain;
  pages: FramePagesMap;
  /** The reader's expansion: here, the references opened in place (`open-references`). */
  expansion: Expansion;
  /** The row each frame's detail view shows, as the outline keeps it (frame id -> node id). */
  details: Readonly<Record<string, string>>;
  /** The day each frame's calendar is open at, as the outline keeps it (frame id -> day). */
  days: Readonly<Record<string, string>>;
  /** The day a calendar not opened at one shows. */
  today: string;
  out: VisibleInstance[];
}

function emitProjectedRows(ctx: WalkContext, frame: ProjectedFrame): void {
  const { frameId, view, rowIds, keyFor } = frame;
  const { nodes, schema, pages, days, today, out } = ctx;
  const { rendered, steps, groupFieldId } = frameRows({
    frameId,
    nodes,
    schema,
    view,
    rowIds,
    pages: pages[frameId],
    day: days[frameId] ?? today,
  });
  for (const child of rendered) {
    const step = steps.get(child.id);
    const row = { nodeId: child.id, instanceKey: keyFor(child.id) };
    out.push(
      step === undefined || groupFieldId === null
        ? row
        : { ...row, group: { frameId, fieldId: groupFieldId, ...step } },
    );
  }
}

/** A frame a projected view lays out: which, in which view, over which rows, keyed how. */
interface ProjectedFrame {
  frameId: string;
  view: FrameView;
  rowIds: string[] | undefined;
  keyFor: (nodeId: string) => string;
}

/**
 * A frame's rows laid out as lanes, each walked as a list row is, so its
 * children nest under it; every row a lane yields is marked with that lane,
 * unless a lane deeper in it marked it first.
 */
function walkLanes(ctx: WalkContext, lanes: ProjectedFrame, chain: SlotChain): void {
  const { frameId, view, rowIds, keyFor } = lanes;
  const { nodes, schema, pages, out } = ctx;
  const heads = frameRows({
    frameId,
    nodes,
    schema,
    view,
    rowIds,
    pages: pages[frameId],
  }).rendered.map((row) => ({ nodeId: row.id, instanceKey: keyFor(row.id) }));
  heads.forEach((head, at) => {
    const from = out.length;
    // A lane always shows its rows, whatever its head's own open state.
    const node = nodes.get(head.nodeId);
    if (node === undefined) return;
    out.push(head);
    walkRowChildren(ctx, node, head.instanceKey, chain);
    const lane: VisibleLane = {
      head,
      before: heads[at - 1] ?? null,
      after: heads[at + 1] ?? null,
    };
    for (let i = from; i < out.length; i++) {
      const row = out[i];
      if (row !== undefined && row.lane === undefined) out[i] = { ...row, lane };
    }
  });
}

/**
 * A frame's rows as its projected view lays them out, inside the frame's
 * slot (`chain`): as lanes, each nesting its rows, or one flat run.
 */
function walkProjectedRows(ctx: WalkContext, frame: ProjectedFrame, chain: SlotChain): void {
  if (laysOutLanes(frame.view)) walkLanes(ctx, frame, chain);
  else if (frame.view.key.rows === "detail") walkDetail(ctx, frame, chain);
  else emitProjectedRows(ctx, frame);
}

/**
 * A frame laid out as a list with detail (DESIGN-UI.md → List with detail):
 * its rows, and after the row its detail shows (`detailRowOf`) that row's
 * children, as a list nests an open row's, since its page draws them.
 */
function walkDetail(ctx: WalkContext, frame: ProjectedFrame, chain: SlotChain): void {
  const from = ctx.out.length;
  emitProjectedRows(ctx, frame);
  const rows = ctx.out.slice(from);
  const shown = detailRowOf(
    rows.map((row) => row.nodeId),
    ctx.details[frame.frameId] ?? null,
  );
  const at = rows.findIndex((row) => row.nodeId === shown);
  const row = rows[at];
  const node = shown === null ? undefined : ctx.nodes.get(shown);
  if (row === undefined || node === undefined) return;
  const after = ctx.out.splice(from + at + 1);
  walkRowChildren(ctx, node, row.instanceKey, chain);
  ctx.out.push(...after);
}

/**
 * The chain under a frame's slot, or null when the slot would not render it —
 * the one rule the slot itself applies (`slotRenders`), so a frame whose rows
 * the outline refused to draw offers none to the keyboard either.
 */
function underSlot(chain: SlotChain, view: FrameView, frameId: string): SlotChain | null {
  const link = slotLink(view.key, frameId);
  return slotRenders(chain, link) ? [...chain, link] : null;
}

/**
 * A query frame's results, as its results section draws them
 * (`QueryResultsSection`): a projected view emits them flat from the
 * frame's slot; the list walks each as a row of its own. A query with no
 * definition, or one that fails, offers none.
 */
function walkQueryResults(
  ctx: WalkContext,
  frame: OutlineNode,
  view: FrameView,
  chain: SlotChain,
): void {
  const def = queryDefOf(frame);
  if (!hasText(def?.edn) || ctx.run === null) return;
  let ids: string[];
  try {
    ids = resultNodeIds(ctx.run(def.edn), ctx.nodes, { limit: def.limit, excludeId: frame.id });
  } catch {
    return;
  }
  const keyFor = (id: string) => projectedRowKey(frame.id, id);
  if (projectsRows(view.key)) {
    const inner = underSlot(chain, view, frame.id);
    if (inner === null) return;
    walkProjectedRows(ctx, { frameId: frame.id, view, rowIds: ids, keyFor }, inner);
    return;
  }
  for (const id of ids) walkVisibleInstances(ctx, id, keyFor(id), chain);
}

function walkVisibleInstances(
  ctx: WalkContext,
  nodeId: string,
  instanceKey: string,
  chain: SlotChain,
): void {
  const { nodes, out } = ctx;
  const node = nodes.get(nodeId);
  if (!node) return;
  out.push({ nodeId, instanceKey });
  // What is under a row is its shown node's (`lib/contextual-ref`), unless
  // that node is already shown above it.
  if (showsAncestor(instanceKey, node, ctx.schema)) return;
  const frame = shownNode(node, ctx.schema);
  // The references its text opens in place come first, open or closed the row.
  // Each draws its target open or closed as the target's own choice is, not
  // open by default: a choice is per node. GAP [[01M7D8AP4A4W6S2X5T1DSE9D77]]
  if (opensInPlace(instanceKey)) {
    for (const id of openReferencesOf(ctx.expansion, frame.id, frame.text)) {
      walkVisibleInstances(ctx, id, openReferenceKey(frame.id, id), chain);
    }
  }
  // Open or closed is the row's own.
  if (node.collapsed) return;
  walkRowChildren(ctx, node, instanceKey, chain);
}

/**
 * The rows under a row: its shown node's (`lib/contextual-ref`), unless that
 * node is already shown above it, as its frame's view lays them out.
 */
function walkRowChildren(
  ctx: WalkContext,
  node: OutlineNode,
  instanceKey: string,
  chain: SlotChain,
): void {
  const { nodes, schema } = ctx;
  if (showsAncestor(instanceKey, node, schema)) return;
  const frame = shownNode(node, schema);
  const frameId = frame.id;

  // A frame whose view is not provided shows no rows, so it offers none.
  const view = frameViewOf(frame, schema, ctx.views);
  if (view === null) return;
  const projected = projectsRows(view.key);

  // A result row does not re-run its own query (`resolveRowChrome` agrees).
  if (!isProjectedRow(instanceKey) && isQueryNode(frame)) {
    walkQueryResults(ctx, frame, view, chain);
    // Non-projected query: also walk structural children below results.
  }

  if (projected && isQueryNode(frame)) return;
  // A frame's children sit in its slot.
  const inner = underSlot(chain, view, frameId);
  if (inner === null) return;
  if (projected) {
    const keyFor = (id: string) => childInstanceKey(instanceKey, id);
    walkProjectedRows(ctx, { frameId, view, rowIds: undefined, keyFor }, inner);
    return;
  }

  for (const child of frameRows({ frameId, nodes, schema, view }).rendered) {
    walkVisibleInstances(ctx, child.id, childInstanceKey(instanceKey, child.id), inner);
  }
}

/**
 * What the walk reads: the graph, the query db, the frame views provided, the
 * slots around the outline's root, the pages revealed, the rows detail
 * views show and the days calendars are open at.
 */
type WalkSource = Omit<WalkContext, "out">;

/**
 * The rows the outline host `host` draws under `rootNodeId`, in render order,
 * each under its instance key in that host.
 */
export function collectVisibleInstances(
  rootNodeId: string,
  source: WalkSource,
  host: string = MAIN_OUTLINE_HOST,
): VisibleInstance[] {
  const out: VisibleInstance[] = [];
  const { nodes, schema, views } = source;
  const root = nodes.get(rootNodeId);
  if (!root) return out;
  const ctx: WalkContext = { ...source, out };

  // The root's rows sit in the root frame's slot, inside the outline's.
  const view = frameViewOf(root, schema, views);
  if (view === null) return out;
  // A query root shows its results, as a query row does, and not its children.
  if (isQueryNode(root)) {
    walkQueryResults(ctx, root, view, source.chain);
    return out;
  }
  const inner = underSlot(source.chain, view, rootNodeId);
  if (inner === null) return out;
  if (projectsRows(view.key)) {
    const keyFor = (id: string) => outlineInstanceKey(id, nodes, host);
    walkProjectedRows(ctx, { frameId: rootNodeId, view, rowIds: undefined, keyFor }, inner);
    return out;
  }

  for (const child of frameRows({ frameId: rootNodeId, nodes, schema, view }).rendered) {
    walkVisibleInstances(ctx, child.id, outlineInstanceKey(child.id, nodes, host), inner);
  }
  return out;
}

export function neighborVisibleInstance(
  instances: VisibleInstance[],
  instanceKey: string,
  dir: -1 | 1,
): VisibleInstance | null {
  const idx = instances.findIndex((i) => i.instanceKey === instanceKey);
  if (idx < 0) return null;
  return instances[idx + dir] ?? null;
}
