/** The outline's key definitions; handlers stay in its page half. */
import { OUTLINE_IDS } from "./ids.ts";
import type { ContributionEntry } from "@kb/plugin";
import {
  TEXT_HISTORY_CHORD,
  printableExcept,
  provideKeybinding,
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

/**
 * The chords both modes share: ⌘⌥↓ and ⌘⌥↑ (Ctrl+Alt on Windows and Linux)
 * open and close a row's whole subtree, ⌘. zooms into the row and ⌘, zooms
 * out to the page above the one shown.
 */
const SUBTREE_CHORDS = {
  expand: { key: "ArrowDown", mod: true, alt: true, shift: false },
  collapse: { key: "ArrowUp", mod: true, alt: true, shift: false },
} as const satisfies Record<string, Chord>;
const ZOOM_CHORDS = {
  in: { key: ".", mod: true },
  out: { key: ",", mod: true },
} as const satisfies Record<string, Chord>;

function editingBinding(id: string, chord: Chord, intent: string): ContributionEntry<Keybinding> {
  return { id: `editing.${id}`, value: { context: EDITING_CONTEXT_ID, chord, run: { intent } } };
}

/**
 * The outline's editing keys, as its contributions to `ui.keybindings`.
 * No two chords overlap, so each says exactly which keys it claims. The
 * arrows are where that matters: ⌘⇧ reorders, ⌘⌥ (Ctrl+Alt) opens or
 * closes the whole subtree, any other command-modified arrow reveals one
 * level (two chords: ⌘ without ⇧ or ⌥, and ⌃ without ⌘ or ⌥), and the bare
 * arrow navigates. Enter is the same: ⇧ alone breaks the line, ⌘⇧ makes a
 * row before this one.
 */
export const EDITING_BINDINGS: readonly ContributionEntry<Keybinding>[] = [
  editingBinding("soft-break", { key: "Enter", shift: true, mod: false }, "soft-break"),
  editingBinding("split", { key: "Enter", shift: false, mod: false }, "split"),
  editingBinding("toggle-check", { key: "Enter", shift: false, mod: true }, "toggle-check"),
  editingBinding("create-before", { key: "Enter", shift: true, mod: true }, "create-before"),
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
    { key: "ArrowUp", meta: true, shift: false, alt: false },
    "collapse-or-leave",
  ),
  editingBinding(
    "collapse-or-leave-ctrl",
    { key: "ArrowUp", meta: false, ctrl: true, alt: false },
    "collapse-or-leave",
  ),
  editingBinding("expand", { key: "ArrowDown", meta: true, shift: false, alt: false }, "expand"),
  editingBinding(
    "expand-ctrl",
    { key: "ArrowDown", meta: false, ctrl: true, alt: false },
    "expand",
  ),
  editingBinding("collapse-subtree", SUBTREE_CHORDS.collapse, "collapse-subtree"),
  editingBinding("expand-subtree", SUBTREE_CHORDS.expand, "expand-subtree"),
  editingBinding("line-up", { key: "ArrowUp", mod: false }, "line-up"),
  editingBinding("line-down", { key: "ArrowDown", mod: false }, "line-down"),
  editingBinding("zoom", ZOOM_CHORDS.in, "zoom"),
  editingBinding("zoom-out", ZOOM_CHORDS.out, "zoom-out"),
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
  selectionBinding("zoom", ZOOM_CHORDS.in),
  selectionBinding("zoom-out", ZOOM_CHORDS.out),
  selectionBinding("expand-subtree", SUBTREE_CHORDS.expand),
  selectionBinding("collapse-subtree", SUBTREE_CHORDS.collapse),
  selectionBinding("up", { key: "ArrowUp", mod: false, shift: false }),
  selectionBinding("down", { key: "ArrowDown", mod: false, shift: false }),
  // Shift moves the selection's head and keeps its anchor: a range of rows.
  selectionBinding("extend-up", { key: "ArrowUp", mod: false, shift: true }),
  selectionBinding("extend-down", { key: "ArrowDown", mod: false, shift: true }),
  selectionBinding("close-or-climb", { key: "ArrowLeft", mod: false }),
  selectionBinding("open-or-descend", { key: "ArrowRight", mod: false }),
  selectionBinding("edit", { key: "Enter", mod: false }),
  selectionBinding("toggle-check", { key: "Enter", mod: true, shift: false }),
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
 * binding but ⌘⇧↑/↓, ⌘⇧←/→, ⌘⌥↑/↓, ⌘. and ⌘, says `mod: false`, so any other command chord
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

/**
 * Copy as… on Mod-Shift-C, a key the page answers wherever focus is
 * (`core.page`), about what ⌘K's commands are about: the selected rows,
 * else the page's node. A page key is offered before the browser's
 * inspector takes the chord.
 */
const COPY_AS_BINDING = provideKeybinding("copy-as", {
  context: "core.page",
  chord: "Mod-Shift-C",
  run: { command: OUTLINE_IDS.copyAsCommand },
});

export const OUTLINE_KEYBOARD = {
  contexts: [EDITING_CONTEXT, SELECTION_CONTEXT],
  bindings: [...EDITING_BINDINGS, ...SELECTION_BINDINGS, COPY_AS_BINDING],
};
