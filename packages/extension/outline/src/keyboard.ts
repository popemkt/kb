/** The outline's key definitions; handlers stay in its page half. */
import type { ContributionEntry } from "@kb/plugin";
import {
  TEXT_HISTORY_CHORD,
  printableExcept,
  type Chord,
  type Keybinding,
  type KeyContextSpec,
} from "@kb/keybindings";
/**
 * The editing row's keys: what the row's text host hands its keydown, the
 * text host having kept composition and its own history first. Owned by
 * the outline, so its bindings are held first and Escape is its alone, with
 * the history chords, which other bindings may never take. The page's keys
 * (⌘K) are offered first, so no binding here may take one.
 */

/** The context's id, as bindings name it: the outline's namespace, then its own. */
export const EDITING_CONTEXT_ID = "outline.editing";

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

export const EDITING_CONTEXT: ContributionEntry<KeyContextSpec> = {
  id: "editing",
  value: {
    reach: "surface",
    intents: [
      ...new Set(
        EDITING_BINDINGS.flatMap(({ value }) => ("intent" in value.run ? [value.run.intent] : [])),
      ),
    ],
    reserved: [{ key: "Escape" }, TEXT_HISTORY_CHORD],
  },
};

const SPACE_KEYS = [" ", "Space", "Spacebar"] as const;
/**
 * The selection's keys, read while a row is selected and none is edited.
 * Owned by the outline, so its bindings are held first and Escape is its
 * alone, with the history chords. The page's keys (⌘K) are offered first.
 */

/** The context's id, as bindings name it: the outline's namespace, then its own. */
export const SELECTION_CONTEXT_ID = "outline.selection";

function selectionBinding(
  id: string,
  chord: Chord,
  intent: string = id,
): ContributionEntry<Keybinding> {
  return {
    id: `selection.${id}`,
    value: { context: SELECTION_CONTEXT_ID, chord, run: { intent } },
  };
}

/**
 * The bindings typing over a row yields to: a character one of them claims
 * is not typed. A character key says `alt: false`, so an Alt-composed glyph
 * (⌥o is ø) is never one of the outline's keys and stays native unless a
 * binding claims its chord.
 */
const SELECTION_KEYS: readonly ContributionEntry<Keybinding>[] = [
  selectionBinding("move-up", { key: "ArrowUp", mod: true, shift: true }),
  selectionBinding("move-down", { key: "ArrowDown", mod: true, shift: true }),
  selectionBinding("move-to-group-before", { key: "ArrowLeft", mod: true, shift: true }),
  selectionBinding("move-to-group-after", { key: "ArrowRight", mod: true, shift: true }),
  selectionBinding("zoom", { key: ".", mod: true }),
  selectionBinding("up", { key: "ArrowUp", mod: false }),
  selectionBinding("down", { key: "ArrowDown", mod: false }),
  selectionBinding("close-or-climb", { key: "ArrowLeft", mod: false }),
  selectionBinding("open-or-descend", { key: "ArrowRight", mod: false }),
  selectionBinding("edit", { key: "Enter", mod: false }),
  selectionBinding("toggle-collapse", { key: SPACE_KEYS, mod: false, alt: false }),
  selectionBinding("outdent", { key: "Tab", shift: true, mod: false }),
  selectionBinding("indent", { key: "Tab", shift: false, mod: false }),
  selectionBinding("create-after", { key: "o", mod: false, alt: false }),
  // Shift+o: a new empty row directly above. Case is the binding, so this is
  // its own row rather than a `shift` constraint on the one above.
  selectionBinding("create-before", { key: "O", mod: false, alt: false }),
  selectionBinding("delete", { key: ["Backspace", "Delete"], mod: false }),
  selectionBinding("clear", { key: "Escape", mod: false }),
];

/**
 * The outline's selection keys, as its contributions to `ui.keybindings`
 * (DESIGN-REFINE §2 W1; r1 §3.2 Mode B). No two chords overlap. Every
 * binding but ⌘⇧↑/↓, ⌘⇧←/→ and ⌘. says `mod: false`, so any other command chord
 * resolves to nothing and stays the browser's or the shell's. Typing over a
 * selected row edits it with the character appended: any printable key but
 * those the bindings above claim, with Alt excluded so Alt-composed glyphs
 * stay native. The keymap alone says which keys are the selection's: an
 * event no binding resolves is left to the page, Alt or not.
 */
export const SELECTION_BINDINGS: readonly ContributionEntry<Keybinding>[] = [
  ...SELECTION_KEYS,
  selectionBinding("append", {
    key: printableExcept(
      SELECTION_KEYS.map(({ value }) => value.chord),
      { mod: false, alt: false },
    ),
    mod: false,
    alt: false,
  }),
];

export const SELECTION_CONTEXT: ContributionEntry<KeyContextSpec> = {
  id: "selection",
  value: {
    reach: "surface",
    intents: [
      ...new Set(
        SELECTION_BINDINGS.flatMap(({ value }) =>
          "intent" in value.run ? [value.run.intent] : [],
        ),
      ),
    ],
    reserved: [{ key: "Escape" }, TEXT_HISTORY_CHORD],
  },
};

export const OUTLINE_KEYBOARD = {
  contexts: [EDITING_CONTEXT, SELECTION_CONTEXT],
  bindings: [...EDITING_BINDINGS, ...SELECTION_BINDINGS],
};
