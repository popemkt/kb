/**
 * The outline's own gestures over the page's write path: the writes are the
 * write path's (`mutations`), and what the outline adds is its rule for the
 * row the gesture leaves — an empty row it mints is transient, pruned when
 * focus leaves it still empty (Tana, r1 §3.3), and "the row above" is the one
 * the outline draws above (r1 D09).
 */
import { queryDefOf } from "@kb/model";
import { requirementsOf } from "@kb/query";
import type { ViewFilter } from "@kb/views";
import { outlineNodes, useOutlineStore } from "./outline.store";
import { browserHost, schemaOf, toast, type FrameSubject, type RowCondition } from "@kb/ui-sdk";

/** The minted id, marked transient; null when the write was refused. */
function transient(id: string | null): string | null {
  if (id !== null) useOutlineStore.getState().markTransient(id);
  return id;
}

/**
 * Tana transient create: mint a real empty node (root, first child, or after
 * sibling), focused at offset 0, and mark it transient. Replaces the
 * detached ghost row entirely.
 */
export async function createTransientNode(
  parentId: string,
  afterSiblingId: string | null,
): Promise<string | null> {
  return transient(await browserHost().writes.createEmptyNode(parentId, afterSiblingId));
}

/**
 * A transient first row of `parentId`, focused: Enter from a page's title
 * opens one above whatever the page holds, as Tana's does.
 */
export async function createFirstChild(parentId: string): Promise<string | null> {
  const [first] = outlineNodes().get(parentId)?.children ?? [];
  return first === undefined ? createTransientNode(parentId, null) : createNodeBefore(first);
}

/** A transient sibling directly ABOVE the anchor, focused ('O' key). */
export async function createNodeBefore(beforeId: string): Promise<string | null> {
  return transient(await browserHost().writes.createEmptyNodeBefore(beforeId));
}

/**
 * Backspace-merge. With the row's instance, the target is what the outline
 * draws directly above the caret: a preceding sibling with expanded children
 * merges into its deepest last descendant.
 */
export async function mergeWithPrevious(id: string, instanceKey?: string): Promise<void> {
  const previous =
    instanceKey === undefined
      ? null
      : (useOutlineStore.getState().getPreviousVisibleInstance(instanceKey)?.nodeId ?? null);
  await browserHost().writes.mergeWithPrevious(id, previous);
}

/**
 * Once the query `queryId` has answered the graph as it is now: a result is
 * drawn only then, so a row just added is opened after it, not before.
 */
async function answered(queryId: string): Promise<void> {
  const edn = queryDefOf(outlineNodes().get(queryId))?.edn;
  const queries = browserHost().graph.state().queries;
  if (edn !== undefined && queries !== null) await queries.ask(edn);
}

/** The one narrowing row a view's filter adds to the query vocabulary. */
type AnywhereFilter = Extract<ViewFilter, { kind: "anywhere-contains" }>;

/**
 * A row where a frame view asks for one (`FrameSubject.addRow`, DESIGN-UI.md
 * → Adding to a frame): empty, carrying what `where` requires
 * (`requirementsOf`, read over the whole graph's fields and options) and the
 * frame's own part: the query it matches, or the frame as its parent. It is
 * transient like any row the outline mints, and opens its text at the
 * instance the frame draws it at (`rowKey`): a query's result shows once the
 * query answers it, so the bare id names no row drawn yet. A toast says when
 * something asked could not be written, so the row may not show where it was
 * asked.
 */
export async function addFrameRow(
  frame: Pick<FrameSubject, "frameId" | "isQuerySource" | "rowKey">,
  where: readonly RowCondition[],
): Promise<string | null> {
  const schema = schemaOf(browserHost().graph.state());
  const req = requirementsOf<AnywhereFilter>(where, (id) => schema.get(id));
  const parent = req.parent ?? (frame.isQuerySource ? undefined : frame.frameId);
  const added = await browserHost().writes.addMatchingNode({
    tags: req.tags,
    props: req.props,
    ...(parent === undefined ? {} : { parent }),
    ...(frame.isQuerySource ? { matching: frame.frameId } : {}),
  });
  if (added === null) return null;
  useOutlineStore.getState().markTransient(added.id);
  if (frame.isQuerySource) await answered(frame.frameId);
  useOutlineStore.getState().activateNode(added.id, 0, frame.rowKey(added.id));
  if (added.unmet + req.unmet.length > 0) {
    toast(
      "Added, but not everything this view asks for could be filled in, so it may not show here",
    );
  }
  return added.id;
}
