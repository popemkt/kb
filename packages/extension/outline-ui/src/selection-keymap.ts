/**
 * Selection-mode keymap (nxus / DESIGN-REFINE §2 W1; r1 §3.2 Mode B).
 * Active only when a node is selected and not being edited.
 */
import type { PropValue } from "@kb/model";
import { keyCallOf, type KeyCall } from "@kb/ui-sdk";
import type { KeyChordEvent, Keymap } from "@kb/keybindings";
import type { InstanceRef, VisibleInstance, VisibleLane } from "./visible-instances";

/** Selection mode reads the same event shape every keymap reads. */
export type SelectionKeyEvent = KeyChordEvent;

export type SelectionKeyAction =
  | { type: "select"; nodeId: string; instanceKey: string }
  /** Move the selection's head a row, keeping its anchor: a range. */
  | { type: "extend"; direction: "up" | "down" }
  | { type: "clear" }
  | { type: "edit"; nodeId: string; instanceKey: string }
  | { type: "toggleCollapse"; nodeId: string }
  | { type: "toggleCheck"; nodeId: string }
  | { type: "collapse"; nodeId: string }
  | { type: "expand"; nodeId: string }
  | { type: "selectParent"; nodeId: string }
  | { type: "selectFirstChild"; nodeId: string; instanceKey: string }
  | { type: "indent"; nodeId: string }
  | { type: "outdent"; nodeId: string }
  | { type: "moveUp"; nodeId: string }
  | { type: "moveDown"; nodeId: string }
  /**
   * Into the group of `value` by its field (DESIGN-UI.md → Groups); a
   * calendar's frame then opens at `opens`, so the row stays drawn.
   */
  | {
      type: "moveToGroup";
      nodeId: string;
      fieldId: string;
      value: PropValue | null;
      frameId: string;
      opens?: string;
    }
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
  /** Where the walk reaches a row instance: the lane it sits in, when its frame lays rows out as lanes. */
  instanceAt?: (instanceKey: string) => VisibleInstance | null;
}

/** The controls that answer their own keys: Enter and Space press them, Tab leaves. */
const CONTROL = "button, a[href], [role='button'], [role='checkbox'], [role='switch']";

/**
 * True when the key's target owns its keys, so the selection does not take
 * them (DESIGN-UI.md → Two keymaps, one row): a text entry, or a control the
 * keyboard stops at, such as a tag's box or the hidden-fields fold. Chrome
 * the keyboard skips (the bullet, `tabIndex` -1) and the selected row itself
 * leave their keys to the selection.
 */
export function ownsItsKeys(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target.isContentEditable || target.closest("[contenteditable='true']") !== null) return true;
  const control = target.closest<HTMLElement>(CONTROL);
  return control !== null && control.tabIndex >= 0;
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

function selectInstance(instance: InstanceRef | null): SelectionKeyAction | null {
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

/** The lane a row instance sits in, or null. */
function laneOf(ctx: SelectionKeyContext, instanceKey: string): VisibleLane | null {
  return ctx.instanceAt?.(instanceKey)?.lane ?? null;
}

/**
 * The lane the selection heads, when it is a lane's head (DESIGN-UI.md →
 * Lanes): there, the horizontal keys move between lanes and Enter goes in.
 */
function headedLane({ ctx, instanceKey }: SelectionTarget): VisibleLane | null {
  const lane = laneOf(ctx, instanceKey);
  return lane !== null && lane.head.instanceKey === instanceKey ? lane : null;
}

/** ArrowLeft: the lane before, on a lane's head; else close what is open, else climb to the parent. */
function closeOrClimb(target: SelectionTarget): SelectionKeyAction | null {
  const lane = headedLane(target);
  if (lane !== null) return selectInstance(lane.before);
  const { nodeId, info } = target;
  if (!info) return null;
  if (!info.collapsed && info.childIds.length > 0) return { type: "collapse", nodeId };
  return info.parentId !== null ? { type: "selectParent", nodeId } : null;
}

/** ArrowRight: the lane after, on a lane's head; else open what is closed, else descend into the first child. */
function openOrDescend(target: SelectionTarget): SelectionKeyAction | null {
  const lane = headedLane(target);
  if (lane !== null) return selectInstance(lane.after);
  const { nodeId, instanceKey, info } = target;
  if (!info) return null;
  if (info.collapsed && info.childIds.length > 0) return { type: "expand", nodeId };
  return info.childIds.length > 0 ? { type: "selectFirstChild", nodeId, instanceKey } : null;
}

/** Enter: into a lane's first row, on the head of a lane that shows rows; else edit the row. */
function editOrEnterLane(target: SelectionTarget): SelectionKeyAction | null {
  const { ctx, nodeId, instanceKey } = target;
  if (headedLane(target) !== null) {
    const first = ctx.getNextVisibleInstance(instanceKey);
    if (first !== null && laneOf(ctx, first.instanceKey)?.head.instanceKey === instanceKey)
      return selectInstance(first);
  }
  return { type: "edit", nodeId, instanceKey };
}

/** Escape: out to the lane's head, on a row inside a lane; else clear the selection. */
function clearOrLeaveLane({ ctx, instanceKey }: SelectionTarget): SelectionKeyAction | null {
  const lane = laneOf(ctx, instanceKey);
  if (lane !== null && lane.head.instanceKey !== instanceKey) return selectInstance(lane.head);
  return { type: "clear" };
}

/**
 * ⌘⇧← and ⌘⇧→: the row into the group before or after its own, as its
 * frame draws them (DESIGN-UI.md → Groups); nothing past either end, or for
 * a row in no group.
 */
function toGroup(side: "before" | "after"): IntentOf {
  return ({ ctx, nodeId, instanceKey }) => {
    const group = ctx.instanceAt?.(instanceKey)?.group;
    const step = group?.[side] ?? null;
    if (group === undefined || step === null) return null;
    const { frameId, fieldId } = group;
    const move = { type: "moveToGroup", nodeId, fieldId, value: step.value, frameId } as const;
    return step.opens === undefined ? move : { ...move, opens: step.opens };
  };
}

/** The selection's intents, by the name a binding runs them by. */
const SELECTION_INTENTS = new Map<string, IntentOf>([
  ["move-up", ({ nodeId }) => ({ type: "moveUp", nodeId })],
  ["move-down", ({ nodeId }) => ({ type: "moveDown", nodeId })],
  ["move-to-group-before", toGroup("before")],
  ["move-to-group-after", toGroup("after")],
  ["zoom", ({ nodeId, instanceKey }) => ({ type: "zoom", nodeId, instanceKey })],
  ["up", upOrIntoFields],
  ["extend-up", () => ({ type: "extend", direction: "up" })],
  ["extend-down", () => ({ type: "extend", direction: "down" })],
  ["down", downOrIntoFields],
  ["close-or-climb", closeOrClimb],
  ["open-or-descend", openOrDescend],
  ["edit", editOrEnterLane],
  ["toggle-collapse", ({ nodeId }) => ({ type: "toggleCollapse", nodeId })],
  ["toggle-check", ({ nodeId }) => ({ type: "toggleCheck", nodeId })],
  ["outdent", ({ nodeId }) => ({ type: "outdent", nodeId })],
  ["indent", ({ nodeId }) => ({ type: "indent", nodeId })],
  ["create-after", ({ nodeId }) => ({ type: "createAfter", nodeId })],
  ["create-before", ({ nodeId }) => ({ type: "createBefore", nodeId })],
  ["delete", ({ nodeId, instanceKey }) => ({ type: "delete", nodeId, instanceKey })],
  ["clear", clearOrLeaveLane],
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
