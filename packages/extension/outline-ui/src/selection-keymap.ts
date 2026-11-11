/**
 * Selection-mode keymap (nxus / DESIGN-REFINE §2 W1; r1 §3.2 Mode B).
 * Active only when a node is selected and not being edited.
 */
import { type KeyChordEvent, keyCallOf, type KeyCall, type Keymap } from "@kb/ui-sdk";
import type { VisibleInstance } from "./visible-instances";

/** Selection mode reads the same event shape every keymap reads. */
export type SelectionKeyEvent = KeyChordEvent;

export type SelectionKeyAction =
  | { type: "select"; nodeId: string; instanceKey: string }
  | { type: "clear" }
  | { type: "edit"; nodeId: string; instanceKey: string }
  | { type: "toggleCollapse"; nodeId: string }
  | { type: "collapse"; nodeId: string }
  | { type: "expand"; nodeId: string }
  | { type: "selectParent"; nodeId: string }
  | { type: "selectFirstChild"; nodeId: string; instanceKey: string }
  | { type: "indent"; nodeId: string }
  | { type: "outdent"; nodeId: string }
  | { type: "moveUp"; nodeId: string }
  | { type: "moveDown"; nodeId: string }
  | { type: "zoom"; nodeId: string; instanceKey: string }
  | { type: "createAfter"; nodeId: string }
  | { type: "createBefore"; nodeId: string }
  | { type: "delete"; nodeId: string; instanceKey: string }
  | { type: "append"; nodeId: string; instanceKey: string; char: string }
  /** Onto a row's field values: its first going down, its last coming up. */
  | { type: "enterFields"; instanceKey: string; which: "first" | "last" }
  | KeyCall;

export interface SelectionNodeInfo {
  collapsed: boolean;
  childIds: string[];
  parentId: string | null;
}

export interface SelectionKeyContext {
  selectedNodeId: string | null;
  selectedInstanceKey: string | null;
  activeNodeId: string | null;
  getPreviousVisibleInstance: (instanceKey: string) => VisibleInstance | null;
  getNextVisibleInstance: (instanceKey: string) => VisibleInstance | null;
  getNode?: (id: string) => SelectionNodeInfo | undefined;
  /** How many field values a row instance shows; a vertical move passes through them. */
  fieldSlotsOf: (instanceKey: string) => number;
}

/** True when the event target is a text field / contentEditable (skip map). */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target.isContentEditable) return true;
  return Boolean(target.closest("[contenteditable='true']"));
}

/** What a binding is handed: the selection, the pressed key, and the context. */
interface SelectionTarget {
  readonly ctx: SelectionKeyContext;
  readonly key: string;
  readonly nodeId: string;
  readonly instanceKey: string;
  readonly info: SelectionNodeInfo | undefined;
}

/** An intent as its binding runs it: the action it means for the selection, or null. */
type IntentOf = (target: SelectionTarget) => SelectionKeyAction | null;

function selectInstance(instance: VisibleInstance | null): SelectionKeyAction | null {
  return instance === null
    ? null
    : { type: "select", nodeId: instance.nodeId, instanceKey: instance.instanceKey };
}

/**
 * ArrowDown: onto the selected row's own field values when it shows any
 * (they are drawn between it and the next row), else the next row.
 */
function downOrIntoFields({ ctx, instanceKey }: SelectionTarget): SelectionKeyAction | null {
  if (ctx.fieldSlotsOf(instanceKey) > 0)
    return { type: "enterFields", instanceKey, which: "first" };
  return selectInstance(ctx.getNextVisibleInstance(instanceKey));
}

/** ArrowUp: onto the field values of the row above when it shows any, else that row. */
function upOrIntoFields({ ctx, instanceKey }: SelectionTarget): SelectionKeyAction | null {
  const above = ctx.getPreviousVisibleInstance(instanceKey);
  if (above !== null && ctx.fieldSlotsOf(above.instanceKey) > 0) {
    return { type: "enterFields", instanceKey: above.instanceKey, which: "last" };
  }
  return selectInstance(above);
}

/** ArrowLeft: close what is open, else climb to the parent. */
function closeOrClimb({ nodeId, info }: SelectionTarget): SelectionKeyAction | null {
  if (!info) return null;
  if (!info.collapsed && info.childIds.length > 0) return { type: "collapse", nodeId };
  return info.parentId !== null ? { type: "selectParent", nodeId } : null;
}

/** ArrowRight: open what is closed, else descend into the first child. */
function openOrDescend({ nodeId, instanceKey, info }: SelectionTarget): SelectionKeyAction | null {
  if (!info) return null;
  if (info.collapsed && info.childIds.length > 0) return { type: "expand", nodeId };
  return info.childIds.length > 0 ? { type: "selectFirstChild", nodeId, instanceKey } : null;
}

/** The selection's intents, by the name a binding runs them by. */
const SELECTION_INTENTS = new Map<string, IntentOf>([
  ["move-up", ({ nodeId }) => ({ type: "moveUp", nodeId })],
  ["move-down", ({ nodeId }) => ({ type: "moveDown", nodeId })],
  ["zoom", ({ nodeId, instanceKey }) => ({ type: "zoom", nodeId, instanceKey })],
  ["up", upOrIntoFields],
  ["down", downOrIntoFields],
  ["close-or-climb", closeOrClimb],
  ["open-or-descend", openOrDescend],
  ["edit", ({ nodeId, instanceKey }) => ({ type: "edit", nodeId, instanceKey })],
  ["toggle-collapse", ({ nodeId }) => ({ type: "toggleCollapse", nodeId })],
  ["outdent", ({ nodeId }) => ({ type: "outdent", nodeId })],
  ["indent", ({ nodeId }) => ({ type: "indent", nodeId })],
  ["create-after", ({ nodeId }) => ({ type: "createAfter", nodeId })],
  ["create-before", ({ nodeId }) => ({ type: "createBefore", nodeId })],
  ["delete", ({ nodeId, instanceKey }) => ({ type: "delete", nodeId, instanceKey })],
  ["clear", () => ({ type: "clear" })],
  [
    "append",
    ({ nodeId, instanceKey, key }) => ({ type: "append", nodeId, instanceKey, char: key }),
  ],
]);

/**
 * Map a keydown to a selection action under `keymap` (the selection
 * context's, `currentKeymap(SELECTION_CONTEXT_ID)`), or null if not handled.
 * Caller should preventDefault when a non-null action is returned.
 */
export function mapSelectionKey(
  ev: SelectionKeyEvent,
  ctx: SelectionKeyContext,
  keymap: Keymap,
): SelectionKeyAction | null {
  const { selectedNodeId, selectedInstanceKey, activeNodeId } = ctx;
  if (selectedNodeId === null || selectedInstanceKey === null || activeNodeId !== null) return null;

  const binding = keymap.resolve(ev);
  if (binding === undefined) return null;
  const { run } = binding.value;
  if (!("intent" in run)) return keyCallOf(run, selectedNodeId);
  const intent = SELECTION_INTENTS.get(run.intent);
  if (intent === undefined) return null;
  return intent({
    ctx,
    key: ev.key,
    nodeId: selectedNodeId,
    instanceKey: selectedInstanceKey,
    info: ctx.getNode?.(selectedNodeId),
  });
}
