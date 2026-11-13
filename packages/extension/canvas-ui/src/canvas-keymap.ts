/**
 * The canvas keymap: what a key does on the canvas, from its key table
 * (`canvas-keys.ts`). Each of the canvas's three contexts has a keymap, as
 * the page's one admission decides it from every plugin's bindings
 * (DESIGN-UI.md → Keybindings, `currentKeymap`), which decides which chord
 * runs which intent. The dispatch, the view menu, the toolbar's hints and
 * the shortcut sheet all read those keymaps, and none of them can disagree
 * with a key.
 *
 * Like the outline's `selection-keymap.ts`, nothing here reads a document, a
 * ref or the DOM: a unit test that contributes the canvas's keys
 * (`test-support/canvas-keys.ts`) reaches the whole table. The appliers live
 * beside the hook that owns the effects (`use-canvas-keyboard`).
 */
import {
  currentKeymap,
  keyCallOf,
  type Chord,
  type KeyCall,
  type KeyChordEvent,
  type Keymap,
} from "@kb/ui-sdk";
import {
  CANVAS_CONTEXT_IDS,
  CANVAS_SHORTCUTS,
  type CanvasIntent,
  type CanvasKeyContextName,
  type CanvasKeyEvent,
  type CanvasMenuName,
  type CanvasShortcut,
} from "@kb/canvas";

/**
 * A chord the canvas claims.
 *
 * `intent: null` is a claim with nothing to do — a selection-only command
 * pressed with nothing selected. That is not the same as claiming nothing:
 * the chord is still consumed, and `preventDefault` still decides whether the
 * browser gets it. Delete, copy and duplicate swallow the default that way;
 * an arrow key does not, and neither does Escape.
 *
 * A binding another plugin contributes may run an action or a command
 * instead of an intent (`call`), about what the page's commands are about.
 */
export interface CanvasKeyBinding {
  intent: CanvasIntent | null;
  call?: KeyCall;
  preventDefault: boolean;
}

export interface CanvasKeyState {
  selectionEmpty: boolean;
  /** A modal transform is under way. */
  transforming: boolean;
  /** Frames are being presented. */
  presenting?: boolean;
  /**
   * Whether an intent has anything to act on in the selection
   * (`intentApplies`): a shortcut that needs a selection treats one with
   * nothing to act on as none (↵ on a frame is the browser's).
   */
  acts?: (intent: CanvasIntent) => boolean;
}

/** What each key is called in a hint. */
const KEY_NAMES: Record<string, string> = {
  BracketLeft: "[",
  BracketRight: "]",
  " ": "Space",
  Space: "Space",
  Backquote: "`",
  NumpadDecimal: "Num.",
  Delete: "Del",
  Backspace: "⌫",
  Escape: "Esc",
  Enter: "↵",
  ArrowLeft: "←",
  ArrowRight: "→",
  ArrowUp: "↑",
  ArrowDown: "↓",
  PageUp: "PgUp",
  PageDown: "PgDn",
};

/** The key a chord names, as one name: its place, or the first spelling of its character. */
function namedKey(chord: Chord): string {
  if (chord.physicalKey !== undefined) return chord.physicalKey;
  if (typeof chord.key === "string") return chord.key;
  if (Array.isArray(chord.key)) return chord.key[0] ?? "";
  return "";
}

/** A chord in words: its modifiers, then its key as the keyboard shows it. */
export function chordHint(chord: Chord): string {
  const named = namedKey(chord);
  const key =
    KEY_NAMES[named] ??
    (/^Numpad\d$/.test(named)
      ? `Num${named.slice(6)}`
      : /^Digit\d$/.test(named)
        ? named.slice(5)
        : /^Key[A-Z]$/.test(named)
          ? named.slice(3)
          : named.length === 1
            ? named.toUpperCase()
            : named);
  const ctrl = chord.ctrl === true ? "⌃" : "";
  const mod = chord.mod === true ? "⌘" : "";
  const alt = chord.alt === true ? "⌥" : "";
  const shift = chord.shift === true ? "⇧" : "";
  return `${ctrl}${mod}${alt}${shift}${key}`;
}

/** The canvas's shortcuts, by the name a binding runs them by. */
const SHORTCUTS_BY_NAME = new Map(CANVAS_SHORTCUTS.map((entry) => [entry.name, entry]));

/** The keymap of the canvas's context `name`, as the page's admission decides it. */
export function canvasKeymap(name: CanvasKeyContextName): Keymap {
  return currentKeymap(CANVAS_CONTEXT_IDS[name]);
}

/** A press of `chord`: its key, or its place, with the modifiers it holds down and no others. */
function pressOf(chord: Chord): KeyChordEvent | null {
  const key =
    typeof chord.key === "string" ? chord.key : Array.isArray(chord.key) ? chord.key[0] : "";
  if (key === undefined || typeof chord.key === "function") return null;
  return {
    key,
    ...(chord.physicalKey === undefined ? {} : { physicalKey: chord.physicalKey }),
    metaKey: chord.meta === true || (chord.mod === true && chord.ctrl !== true),
    ctrlKey: chord.ctrl === true,
    shiftKey: chord.shift === true,
    altKey: chord.alt === true,
  };
}

/**
 * The chords that press `entry` now: those its context's keymap holds for
 * it whose own press still reaches it, so one another binding replaced is
 * not named.
 */
export function heldChords(entry: CanvasShortcut): readonly Chord[] {
  const keymap = canvasKeymap(entry.context);
  return keymap.held
    .filter(({ id, value }) => {
      if (!("intent" in value.run) || value.run.intent !== entry.name) return false;
      const press = pressOf(value.chord);
      return press !== null && keymap.resolve(press)?.id === id;
    })
    .map(({ value }) => value.chord);
}

/** `entry`'s keys in words, as a menu or a tooltip shows them: its first chord's; "" for none. */
export function hintOf(entry: CanvasShortcut): string {
  const held = heldChords(entry);
  const [first] = held;
  if (first === undefined) return "";
  const hint = chordHint(first);
  if (entry.hintStyle !== "arrows") return hint;
  const prefix = hint.replace(/[←↑→↓]$/, "");
  const keys = new Set(held.map(chordHint));
  return prefix + ["←", "↑", "→", "↓"].filter((arrow) => keys.has(prefix + arrow)).join("");
}

/** A command a menu lists: a shortcut whose intent is known before any key is pressed, and its key. */
export type CanvasMenuCommand = CanvasShortcut & {
  readonly intent: CanvasIntent;
  readonly hint: string;
};

const isKnown = (
  entry: CanvasShortcut,
): entry is CanvasShortcut & { readonly intent: CanvasIntent } =>
  entry.intent !== null && typeof entry.intent !== "function";

/**
 * Menu `menu`'s rows of commands, tldraw's: the shortcuts the table places
 * in it (`menus`), each with its key, so a row and its key cannot mean
 * different things.
 */
export function menuRows(menu: CanvasMenuName): readonly (readonly CanvasMenuCommand[])[] {
  const placed = CANVAS_SHORTCUTS.filter(isKnown)
    .flatMap((entry) => {
      const place = entry.menus?.[menu];
      return place === undefined
        ? []
        : [{ command: { ...entry, hint: hintOf(entry) }, row: place[0], at: place[1] }];
    })
    .toSorted((a, b) => a.row - b.row || a.at - b.at);
  const rows = new Map<number, CanvasMenuCommand[]>();
  for (const { command: entry, row } of placed) rows.set(row, [...(rows.get(row) ?? []), entry]);
  return [...rows.values()];
}

const claim = (intent: CanvasIntent | null, preventDefault = true): CanvasKeyBinding => ({
  intent,
  preventDefault,
});

/** The contexts a state offers a key to, in turn. */
const contextsOf = (state: CanvasKeyState): readonly CanvasKeyContextName[] =>
  state.transforming ? ["transform"] : state.presenting === true ? ["present", "rest"] : ["rest"];

/** What pressing `found` in `state` claims. */
function bindingOf(found: CanvasShortcut, event: CanvasKeyEvent, state: CanvasKeyState) {
  // A held key acts once in a modal transform: holding X would cycle the axes, a digit type dozens.
  if (found.context === "transform" && event.repeat === true && found.repeats !== true) {
    return claim(null);
  }
  if (found.needsSelection !== undefined && state.selectionEmpty) {
    return claim(null, found.needsSelection === "swallow");
  }
  const intent = typeof found.intent === "function" ? found.intent(event) : found.intent;
  if (found.needsSelection !== undefined && intent !== null && state.acts?.(intent) === false) {
    return claim(null, found.needsSelection === "swallow");
  }
  return claim(intent, found.prevent);
}

/**
 * The chord's binding, or null when the canvas does not claim the chord. A
 * modal transform claims every chord: any its keymap does not hold does
 * nothing, its browser default kept (a held one is swallowed).
 */
export function mapCanvasKey(
  event: CanvasKeyEvent,
  state: CanvasKeyState,
): CanvasKeyBinding | null {
  for (const name of contextsOf(state)) {
    const run = canvasKeymap(name).resolve(event)?.value.run;
    if (run === undefined) continue;
    if (!("intent" in run)) {
      const call = keyCallOf(run, null);
      if (call !== null) return { intent: null, call, preventDefault: true };
      continue;
    }
    const found = SHORTCUTS_BY_NAME.get(run.intent);
    if (found !== undefined) return bindingOf(found, event, state);
  }
  if (state.transforming) return claim(null, event.repeat === true);
  return null;
}

/** The hint of the shortcut that asks for `intent`, as a tooltip shows it; "" for none. */
export function shortcutHint(intent: CanvasIntent): string {
  const wanted = JSON.stringify(intent);
  const found = CANVAS_SHORTCUTS.find((entry) => JSON.stringify(entry.intent) === wanted);
  return found === undefined ? "" : hintOf(found);
}
