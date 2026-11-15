/**
 * What each selection action does, one named step per action type.
 *
 * The mapper decides *which* action a chord means; this decides *what* the
 * action does. Keeping them apart is what lets the chord table be tested as
 * data and the store choreography — parent lookup plus scroll, create-after
 * placement, the delete's focus hand-off — be read and tested as steps.
 *
 * Exhaustiveness is the mapped type: a new `SelectionKeyAction` variant with
 * no row here fails the build, so adding an action adds a row rather than a
 * branch.
 */
import { createNodeBefore, createTransientNode, toggleRowChecks } from "./editing-writes";
import {
  asOneWrite,
  browserHost,
  childInstanceKey,
  selectionRoots,
  runKeyCall,
  rowTextOf,
  shownNode,
  shownNodeId,
  WORKSPACE_ROOT_ID,
} from "@kb/ui-sdk";
import type { SelectionKeyAction } from "./selection-keymap";
import { outlineSource, useOutlineStore, outlineNodes } from "./outline.store";
import { enterFields } from "./value-slot-nav";
import { openFromRow } from "./outline-hosts";

type ActionOf<T extends SelectionKeyAction["type"]> = Extract<SelectionKeyAction, { type: T }>;

type SelectionSteps = {
  [T in SelectionKeyAction["type"]]: (action: ActionOf<T>) => void;
};

function scrollRowIntoView(nodeId: string): void {
  requestAnimationFrame(() => {
    document
      .querySelector(`[data-node-id="${CSS.escape(nodeId)}"]`)
      ?.scrollIntoView({ block: "nearest" });
  });
}

function selectParent({ nodeId }: ActionOf<"selectParent">): void {
  const store = useOutlineStore.getState();
  const parent = outlineNodes().get(nodeId)?.parentId ?? null;
  if (parent === null) return;
  store.selectNode(parent);
  scrollRowIntoView(parent);
}

/** The children a row shows — its shown node's (`lib/contextual-ref`). */
function shownChildren(nodeId: string): readonly string[] {
  const node = outlineNodes().get(nodeId);
  return node ? shownNode(node, browserHost().schema()).children : [];
}

/** The first child as drawn under this row instance, not at its own place. */
function selectFirstChild({ nodeId, instanceKey }: ActionOf<"selectFirstChild">): void {
  const first = shownChildren(nodeId)[0];
  if (first !== undefined) {
    useOutlineStore.getState().selectNode(first, childInstanceKey(instanceKey, first));
  }
}

/** 'o': directly below = first child when expanded, else next sibling (D07). */
function createAfter({ nodeId }: ActionOf<"createAfter">): void {
  const node = outlineNodes().get(nodeId);
  const expanded = Boolean(node && !node.collapsed && shownChildren(nodeId).length > 0);
  if (node && expanded) {
    // Under the node the row shows: a reference's first child is its target's.
    void createTransientNode(shownNodeId(node), null);
    return;
  }
  void createTransientNode(node?.parentId ?? WORKSPACE_ROOT_ID, nodeId);
}

/** A printable character: activate at text end with the character appended. */
function append({ nodeId, instanceKey, char }: ActionOf<"append">): void {
  const store = useOutlineStore.getState();
  const { text, textNodeId } = rowTextOf(outlineSource(), nodeId);
  const nextText = text + char;
  store.activateNode(nodeId, nextText.length, instanceKey);
  void browserHost().writes.updateNodeContent(textNodeId, nextText);
}

/** Open the page of the node the row shows — a reference's original — as its outline opens one. */
function zoom({ nodeId, instanceKey }: ActionOf<"zoom">): void {
  const node = outlineNodes().get(nodeId);
  openFromRow(instanceKey, node ? shownNodeId(node) : nodeId);
}

/**
 * The rows a move or a delete acts on (DESIGN-UI.md → Outline editor, "A
 * selection is a range of rows"): a range's top rows, in order, else the
 * row the action names.
 */
function topRows(nodeId: string): { readonly ids: readonly string[]; readonly range: boolean } {
  const rows = useOutlineStore.getState().selectedRows();
  if (rows.length <= 1) return { ids: [nodeId], range: false };
  return {
    ids: selectionRoots(
      rows.map((row) => row.nodeId),
      outlineNodes(),
    ),
    range: true,
  };
}

/**
 * The rows what marks a node acts on (DESIGN-UI.md → Outline editor, "A
 * selection is a range of rows"): each row of a range, in order, else the
 * row the action names.
 */
function eachRow(nodeId: string): readonly string[] {
  const rows = useOutlineStore.getState().selectedRows();
  return rows.length <= 1 ? [nodeId] : rows.map((row) => row.nodeId);
}

/** The node an instance key ends at. */
const nodeOfKey = (instanceKey: string): string =>
  instanceKey.slice(instanceKey.lastIndexOf("/") + 1);

/**
 * Move the rows the selection acts on as one block (`write`), then select
 * the range again at their new rows, its anchor and head where they were.
 */
function arrange(write: (ids: readonly string[]) => Promise<void>, nodeId: string): void {
  const { ids, range } = topRows(nodeId);
  const { selectionAnchorKey } = useOutlineStore.getState();
  void write(ids).then(() => {
    if (range && selectionAnchorKey !== null) {
      useOutlineStore.getState().selectRange(nodeOfKey(selectionAnchorKey), nodeId);
    }
  });
}

/**
 * Delete the rows the selection acts on, as one write, then take the focus
 * to the visible row before them, else the one after. A refused delete
 * leaves the rows where they were, and the selection on them.
 */
function deleteRow({ nodeId, instanceKey }: ActionOf<"delete">): void {
  const store = useOutlineStore.getState();
  const rows = store.selectedRows();
  const first = rows[0]?.instanceKey ?? instanceKey;
  const last = rows.at(-1)?.instanceKey ?? instanceKey;
  const prev = store.getPreviousVisibleInstance(first);
  const next = store.getNextVisibleInstance(last);
  const { ids } = topRows(nodeId);
  const { writes } = browserHost();
  void asOneWrite(ids, () => Promise.all(ids.map((id) => writes.deleteNode(id)))).then(() => {
    if (ids.some((id) => outlineNodes().has(id))) return;
    const pick = prev ?? next;
    if (pick) {
      useOutlineStore.getState().selectNode(pick.nodeId, pick.instanceKey);
      return;
    }
    useOutlineStore.getState().selectNode(null);
  });
}

const SELECTION_STEPS: SelectionSteps = {
  select: ({ nodeId, instanceKey }) => useOutlineStore.getState().selectNode(nodeId, instanceKey),
  extend: ({ direction }) => useOutlineStore.getState().extendSelection(direction),
  enterFields: ({ instanceKey, which }) => void enterFields(instanceKey, which),
  clear: () => useOutlineStore.getState().selectNode(null),
  edit: ({ nodeId, instanceKey }) =>
    useOutlineStore.getState().activateNode(nodeId, 0, instanceKey),
  // Three chords, one gesture: ArrowLeft and ArrowRight only reach these rows
  // when the toggle would move in their direction.
  toggleCollapse: ({ nodeId }) => useOutlineStore.getState().toggleCollapse(nodeId),
  toggleCheck: ({ nodeId }) => void toggleRowChecks(eachRow(nodeId)),
  collapse: ({ nodeId }) => useOutlineStore.getState().toggleCollapse(nodeId),
  expand: ({ nodeId }) => useOutlineStore.getState().toggleCollapse(nodeId),
  selectParent,
  selectFirstChild,
  indent: ({ nodeId }) => arrange((ids) => browserHost().writes.indentNodes(ids), nodeId),
  outdent: ({ nodeId }) => arrange((ids) => browserHost().writes.outdentNodes(ids), nodeId),
  moveUp: ({ nodeId }) => arrange((ids) => browserHost().writes.moveNodesUp(ids), nodeId),
  moveDown: ({ nodeId }) => arrange((ids) => browserHost().writes.moveNodesDown(ids), nodeId),
  zoom,
  createAfter,
  createBefore: ({ nodeId }) => void createNodeBefore(nodeId),
  append,
  delete: deleteRow,
  runAction: (step) => void runKeyCall(step),
  runCommand: (step) => void runKeyCall(step),
};

/**
 * Run the step for `action`.
 *
 * The generic key is what makes the indexed call typecheck without a cast: with
 * `T` bound to the action's own `type`, the table entry and the action are
 * correlated by construction.
 */
export function applySelectionAction<T extends SelectionKeyAction["type"]>(
  action: ActionOf<T>,
): void {
  SELECTION_STEPS[action.type](action);
}
