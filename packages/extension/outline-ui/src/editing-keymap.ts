/**
 * Mode A editing keymap (r1 §3.2) — chord to intent, as data.
 *
 * The pure half of the outline's editing contract: given a chord and what the
 * row looks like right now, which intent does it mean. Nothing here touches
 * the store or the DOM, so the merge/split/indent rules are readable and
 * testable without a live editor; {@link ./editing-intents} carries them out.
 *
 * Its chords are the outline's contributions to `ui.keybindings`, each
 * running one of the row's intents by name, and resolve through the page's
 * one keymap (`currentKeymap`), as the selection's do. The keymap sits on the outline surface rather than in `lib/` because its context
 * is caret geometry: {@link VerticalNavDecision} belongs to `./caret`, and a
 * leaf module may not reach up here for it.
 */
import type { ContributionEntry } from "@kb/plugin";
import { outlineExtension } from "@kb/outline";
import {
  PALETTE_CHORD,
  TEXT_HISTORY_CHORD,
  type Chord,
  type KeyChordEvent,
  type KeyContextSpec,
  type Keybinding,
  type Keymap,
  type VerticalNavDecision,
} from "@kb/ui-sdk";
import type { VisibleInstance } from "./visible-instances";
import { runActionOf, type RunAction } from "./key-action";

/** What the row looks like to the keymap. Offsets are SERIALIZED offsets. */
export interface EditingKeyContext {
  /**
   * The row is a query result (`isQueryResultInstance`): its place under the
   * query is computed, so there is no child edge for a structural chord to
   * move, split or merge.
   */
  readonly isQueryResult: boolean;
  readonly nodeId: string;
  readonly instanceKey: string;
  readonly cursor: number;
  /** The text the row shows and edits (`rowTextOf`); `cursor` is an offset into it. */
  readonly text: string;
  readonly childCount: number;
  readonly collapsed: boolean;
  readonly tagCount: number;
  readonly parentId: string | null;
  /** Index among the parent's children; -1 when no parent row holds this one. */
  readonly siblingIndex: number;
  readonly previousInstance: VisibleInstance | null;
  readonly nextInstance: VisibleInstance | null;
  /** Length of the text a row shows, by row id. */
  readonly textLengthOf: (nodeId: string) => number;
  /**
   * Whether a row's shown text is its own. A contextual reference shows its
   * target's, so text-joining chords (split mid-text, the two merges) have no
   * string of the row's to cut or join; structural chords are unaffected,
   * because the row's place is its own.
   */
  readonly ownsText: (nodeId: string) => boolean;
  /**
   * Visual-line decision for the pressed arrow (D10/D11).
   *
   * A function, not a value: reading caret geometry costs a layout probe, and
   * only the two bare-arrow chords ask for one.
   */
  readonly readVerticalDecision: (key: string) => VerticalNavDecision;
  /**
   * How many field values a row instance shows (`fieldSlotCount`). A row's
   * values sit between its text and its children, so a vertical move passes
   * through them.
   */
  readonly fieldSlotsOf: (instanceKey: string) => number;
}

export type EditingIntent =
  /** Claimed and deliberately inert — the key must not reach the browser. */
  | { type: "claim" }
  | { type: "softBreak"; nodeId: string; instanceKey: string; cursor: number }
  | { type: "split"; nodeId: string; cursor: number | "end" }
  | { type: "indent"; nodeId: string; cursor: number }
  | { type: "outdent"; nodeId: string; cursor: number }
  | { type: "deleteSubtree"; nodeId: string; instanceKey: string }
  | { type: "deleteEmptyRow"; nodeId: string; instanceKey: string }
  | { type: "mergeIntoPrevious"; nodeId: string; instanceKey: string }
  | {
      type: "mergeNextIn";
      nodeId: string;
      instanceKey: string;
      nextNodeId: string;
      caret: number;
    }
  | { type: "moveUp"; nodeId: string }
  | { type: "moveDown"; nodeId: string }
  | { type: "toggleCollapse"; nodeId: string }
  | { type: "zoomToParent"; parentId: string; instanceKey: string }
  | {
      type: "moveCaretToRow";
      nodeId: string;
      instanceKey: string;
      cursor: number;
      x: number | null;
    }
  | { type: "select"; nodeId: string; instanceKey: string }
  /** Onto a row's field values: its first going down, its last coming up. */
  | { type: "enterFields"; instanceKey: string; which: "first" | "last" }
  | RunAction;

/** An intent as its binding runs it: what it means on this row, or null to leave the key native. */
type IntentOf = (ctx: EditingKeyContext) => EditingIntent | null;

const CLAIM: EditingIntent = { type: "claim" };

/**
 * An intent that restructures the outline, which a query-result row
 * swallows where `swallows` holds. A result's place under the query is
 * computed, not a child edge, so a structural edit would restructure the
 * node's real home — rows the user is not looking at.
 */
function structural(
  intent: IntentOf,
  swallows: (ctx: EditingKeyContext) => boolean = () => true,
): IntentOf {
  return (ctx) => (ctx.isQueryResult && swallows(ctx) ? CLAIM : intent(ctx));
}

/** Delete the subtree and hand focus to a surviving neighbour. */
function deleteSubtree(ctx: EditingKeyContext): EditingIntent {
  return { type: "deleteSubtree", nodeId: ctx.nodeId, instanceKey: ctx.instanceKey };
}
/**
 * Unmodified Backspace, in the order the row's shape decides it.
 *
 * Mid-text is the browser's; at offset 0 an empty leaf deletes itself, a first
 * child outdents rather than swallowing its parent (D08), and anything deeper
 * merges into the VISIBLE predecessor (D09). The forest's top edge has nothing
 * above it, so the key stays native.
 */
function backspaceIntent(ctx: EditingKeyContext): EditingIntent | null {
  if (ctx.cursor !== 0) return null;
  if (ctx.text === "" && ctx.childCount === 0) {
    return { type: "deleteEmptyRow", nodeId: ctx.nodeId, instanceKey: ctx.instanceKey };
  }
  if (ctx.siblingIndex === 0) {
    return { type: "outdent", nodeId: ctx.nodeId, cursor: ctx.cursor };
  }
  if (ctx.siblingIndex > 0) {
    // A merge joins this text onto the row above; either string not being
    // its row's own leaves nothing to join, so the key is claimed inert.
    const above = ctx.previousInstance;
    if (!ctx.ownsText(ctx.nodeId) || (above !== null && !ctx.ownsText(above.nodeId))) {
      return { type: "claim" };
    }
    return { type: "mergeIntoPrevious", nodeId: ctx.nodeId, instanceKey: ctx.instanceKey };
  }
  return null;
}

/** Unmodified forward delete: at end of text, merge the next visible row in (F13). */
function deleteIntent(ctx: EditingKeyContext): EditingIntent | null {
  if (ctx.cursor !== ctx.text.length) return null;
  const next = ctx.nextInstance;
  if (next === null || next.nodeId === ctx.nodeId) return null;
  if (!ctx.ownsText(ctx.nodeId) || !ctx.ownsText(next.nodeId)) return { type: "claim" };
  return {
    type: "mergeNextIn",
    nodeId: ctx.nodeId,
    instanceKey: ctx.instanceKey,
    nextNodeId: next.nodeId,
    caret: ctx.text.length,
  };
}

/**
 * A modified arrow reveals or hides: up closes an open parent, else leaves for
 * the enclosing page; down opens a closed row that has something to show —
 * children OR tags, since a tagged childless row still has field rows.
 * Neither is ever native, so a row with nothing to reveal still claims the key.
 */
function revealIntent(ctx: EditingKeyContext, key: string): EditingIntent {
  if (key === "ArrowUp") {
    if (ctx.childCount > 0 && !ctx.collapsed) {
      return { type: "toggleCollapse", nodeId: ctx.nodeId };
    }
    return ctx.parentId === null
      ? { type: "claim" }
      : { type: "zoomToParent", parentId: ctx.parentId, instanceKey: ctx.instanceKey };
  }
  if (ctx.collapsed && (ctx.childCount > 0 || ctx.tagCount > 0)) {
    return { type: "toggleCollapse", nodeId: ctx.nodeId };
  }
  return { type: "claim" };
}

/**
 * A bare arrow crosses rows only from the outermost visual line (D10/D11).
 * What is drawn between two rows is crossed on the way: going down, this
 * row's own field values; coming up, the values of the row above.
 */
function crossRowIntent(ctx: EditingKeyContext, key: string): EditingIntent | null {
  const decision = ctx.readVerticalDecision(key);
  if (decision.kind === "within") return null;
  if (decision.direction === 1 && ctx.fieldSlotsOf(ctx.instanceKey) > 0) {
    return { type: "enterFields", instanceKey: ctx.instanceKey, which: "first" };
  }
  const neighbour = decision.direction === -1 ? ctx.previousInstance : ctx.nextInstance;
  if (neighbour === null) return null;
  if (decision.direction === -1 && ctx.fieldSlotsOf(neighbour.instanceKey) > 0) {
    return { type: "enterFields", instanceKey: neighbour.instanceKey, which: "last" };
  }
  return {
    type: "moveCaretToRow",
    nodeId: neighbour.nodeId,
    instanceKey: neighbour.instanceKey,
    cursor: decision.direction === -1 ? ctx.textLengthOf(neighbour.nodeId) : 0,
    x: decision.x,
  };
}

/**
 * The editing row's intents, by the name a binding runs them by. Each
 * answers "which of this key's meanings" from the row's shape; the chord
 * that runs it is its binding's.
 */
const EDITING_INTENTS = new Map<string, IntentOf>([
  // Soft line break inside the node — never a split (§3.2).
  [
    "soft-break",
    (ctx) => ({
      type: "softBreak",
      nodeId: ctx.nodeId,
      instanceKey: ctx.instanceKey,
      cursor: ctx.cursor,
    }),
  ],
  // Expanded parent ⇒ first child; otherwise sibling-after (D07). A row whose
  // text is not its own is never cut: Enter only opens the next row.
  [
    "split",
    structural((ctx) => ({
      type: "split",
      nodeId: ctx.nodeId,
      cursor: ctx.ownsText(ctx.nodeId) ? ctx.cursor : "end",
    })),
  ],
  ["outdent", structural((ctx) => ({ type: "outdent", nodeId: ctx.nodeId, cursor: ctx.cursor }))],
  ["indent", structural((ctx) => ({ type: "indent", nodeId: ctx.nodeId, cursor: ctx.cursor }))],
  // Delete the subtree — an offset-0 gesture: mid-text the caret check
  // returns first, so the modifier alone never restructures a row.
  ["delete-subtree-at-start", structural((ctx) => (ctx.cursor === 0 ? deleteSubtree(ctx) : null))],
  ["backspace", structural(backspaceIntent, (ctx) => ctx.cursor === 0)],
  ["delete-subtree", structural(deleteSubtree)],
  // Forward delete at the end merges the next row in — a structural join too.
  ["delete-forward", structural(deleteIntent, (ctx) => ctx.cursor === ctx.text.length)],
  ["move-up", structural((ctx) => ({ type: "moveUp", nodeId: ctx.nodeId }))],
  ["move-down", structural((ctx) => ({ type: "moveDown", nodeId: ctx.nodeId }))],
  ["collapse-or-leave", (ctx) => revealIntent(ctx, "ArrowUp")],
  ["expand", (ctx) => revealIntent(ctx, "ArrowDown")],
  ["line-up", (ctx) => crossRowIntent(ctx, "ArrowUp")],
  ["line-down", (ctx) => crossRowIntent(ctx, "ArrowDown")],
  // Popups handle Escape before delegating; bare Escape selects.
  ["select", (ctx) => ({ type: "select", nodeId: ctx.nodeId, instanceKey: ctx.instanceKey })],
]);

/**
 * The editing row's keys: what the row's text host hands its keydown, the
 * text host having kept composition and its own history first. Owned by
 * the outline, so its bindings are held first and Escape is its alone, with
 * the history chords and the palette's ⌘K, which other bindings may never take.
 */
export const EDITING_CONTEXT: ContributionEntry<KeyContextSpec> = {
  id: "editing",
  value: {
    intents: [...EDITING_INTENTS.keys()],
    reserved: [{ key: "Escape" }, TEXT_HISTORY_CHORD, PALETTE_CHORD],
  },
};

/** The context's id, as bindings name it: the outline's namespace, then its own. */
export const EDITING_CONTEXT_ID = `${outlineExtension.name}.${EDITING_CONTEXT.id}`;

function editingBinding(id: string, chord: Chord, intent: string): ContributionEntry<Keybinding> {
  return { id: `editing.${id}`, value: { context: EDITING_CONTEXT_ID, chord, run: { intent } } };
}

/**
 * The outline's editing keys, as its contributions to `ui.keybindings`.
 * No two chords overlap, so each says exactly which keys it claims. The
 * arrows are where that matters: ⌘⇧ reorders, any other command-modified
 * arrow reveals (two chords: ⌘ without ⇧, and ⌃ without ⌘), and the bare
 * arrow navigates.
 */
export const EDITING_BINDINGS: readonly ContributionEntry<Keybinding>[] = [
  editingBinding("soft-break", { key: "Enter", shift: true }, "soft-break"),
  editingBinding("split", { key: "Enter", shift: false }, "split"),
  editingBinding("outdent", { key: "Tab", shift: true }, "outdent"),
  editingBinding("indent", { key: "Tab", shift: false }, "indent"),
  editingBinding(
    "delete-subtree-at-start",
    { key: "Backspace", mod: true },
    "delete-subtree-at-start",
  ),
  editingBinding("backspace", { key: "Backspace", mod: false }, "backspace"),
  editingBinding("delete-subtree", { key: "Delete", mod: true }, "delete-subtree"),
  editingBinding("delete-forward", { key: "Delete", mod: false }, "delete-forward"),
  editingBinding("move-up", { key: "ArrowUp", meta: true, shift: true }, "move-up"),
  editingBinding("move-down", { key: "ArrowDown", meta: true, shift: true }, "move-down"),
  editingBinding(
    "collapse-or-leave",
    { key: "ArrowUp", meta: true, shift: false },
    "collapse-or-leave",
  ),
  editingBinding(
    "collapse-or-leave-ctrl",
    { key: "ArrowUp", meta: false, ctrl: true },
    "collapse-or-leave",
  ),
  editingBinding("expand", { key: "ArrowDown", meta: true, shift: false }, "expand"),
  editingBinding("expand-ctrl", { key: "ArrowDown", meta: false, ctrl: true }, "expand"),
  editingBinding("line-up", { key: "ArrowUp", mod: false }, "line-up"),
  editingBinding("line-down", { key: "ArrowDown", mod: false }, "line-down"),
  editingBinding("select", { key: "Escape" }, "select"),
];

/**
 * The intent a chord means on this row under `keymap` (the editing
 * context's, `currentKeymap(EDITING_CONTEXT_ID)`), or null to leave the key to
 * the browser. A non-null intent is always claimed with `preventDefault`.
 */
export function mapEditingKey(
  ev: KeyChordEvent,
  ctx: EditingKeyContext,
  keymap: Keymap,
): EditingIntent | null {
  const binding = keymap.resolve(ev);
  if (binding === undefined) return null;
  const { run } = binding.value;
  if ("action" in run) return runActionOf(run, ctx.nodeId);
  return EDITING_INTENTS.get(run.intent)?.(ctx) ?? null;
}
