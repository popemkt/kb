/**
 * Render-order visible outline instances (tree + query-result rows).
 *
 * Row order is not decided here — every frame's rows come from
 * {@link frameRows}, the function the renderers call, as each frame's view
 * ({@link frameViewOf}) lays them out. This walk only assigns instance keys and recurses.
 */
import {
  childInstanceKey,
  frameRows,
  type FrameView,
  frameViewOf,
  hasText,
  isQueryResultInstance,
  type EdnRunner,
  MAIN_OUTLINE_HOST,
  type NodeMap,
  outlineInstanceKey,
  type OutlineNode,
  queryResultInstanceKey,
  resultNodeIds,
  type SchemaIndex,
  shownNode,
  showsAncestor,
  type SlotChain,
  slotLink,
  slotRenders,
} from "@kb/ui-sdk";
import { isQueryNode, queryDefOf } from "@kb/model";
import { projectsRows, type FrameViewKey } from "@kb/views";

export type VisibleInstance = {
  nodeId: string;
  instanceKey: string;
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
  out: VisibleInstance[];
}

function emitProjectedRows(
  ctx: WalkContext,
  frameId: string,
  view: FrameView,
  rowIds: string[] | undefined,
  keyFor: (nodeId: string) => string,
): void {
  const { nodes, schema, pages, out } = ctx;
  const { rendered } = frameRows({
    frameId,
    nodes,
    schema,
    view,
    rowIds,
    pages: pages[frameId],
  });
  for (const child of rendered) {
    out.push({ nodeId: child.id, instanceKey: keyFor(child.id) });
  }
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
  const keyFor = (id: string) => queryResultInstanceKey(frame.id, id);
  if (projectsRows(view.key)) {
    if (underSlot(chain, view, frame.id) !== null)
      emitProjectedRows(ctx, frame.id, view, ids, keyFor);
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
  const { nodes, schema, out } = ctx;
  const node = nodes.get(nodeId);
  if (!node) return;
  out.push({ nodeId, instanceKey });
  // Open or closed is the row's own; what is under it is its shown node's
  // (`lib/contextual-ref`), unless that node is already shown above it.
  if (node.collapsed || showsAncestor(instanceKey, node, schema)) return;
  const frame = shownNode(node, schema);
  const frameId = frame.id;

  // A frame whose view is not provided shows no rows, so it offers none.
  const view = frameViewOf(frame, schema, ctx.views);
  if (view === null) return;
  const projected = projectsRows(view.key);

  // A result row does not re-run its own query (`resolveRowChrome` agrees).
  if (!isQueryResultInstance(instanceKey) && isQueryNode(frame)) {
    walkQueryResults(ctx, frame, view, chain);
    // Non-projected query: also walk structural children below results.
  }

  if (projected && isQueryNode(frame)) return;
  // A frame's children sit in its slot.
  const inner = underSlot(chain, view, frameId);
  if (inner === null) return;
  if (projected) {
    emitProjectedRows(ctx, frameId, view, undefined, (id) => childInstanceKey(instanceKey, id));
    return;
  }

  for (const child of frameRows({ frameId, nodes, schema, view }).rendered) {
    walkVisibleInstances(ctx, child.id, childInstanceKey(instanceKey, child.id), inner);
  }
}

/**
 * What the walk reads: the graph, the query db, the frame views provided, the
 * slots around the outline's root and the pages revealed.
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
    emitProjectedRows(ctx, rootNodeId, view, undefined, (id) =>
      outlineInstanceKey(id, nodes, host),
    );
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
