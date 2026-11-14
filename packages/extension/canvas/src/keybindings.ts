/**
 * The canvas's keys, as data: three key contexts (DESIGN-UI.md →
 * Keybindings), the canvas at rest (`canvas.rest`), a modal transform
 * (`canvas.transform`) and present mode (`canvas.present`), each with its
 * intents, as one table of shortcuts (`CANVAS_SHORTCUTS`). A shortcut is an
 * intent: what it is called, where it is listed, what it asks for, and the
 * chords kb binds it to, which are canvas-ui's bindings (`CANVAS_BINDINGS`).
 * No two of a context's chords overlap, so their order means nothing; a
 * chord by place (`physicalKey`) is asked before one by character.
 *
 * canvas-ui contributes the contexts and the bindings to the page kernel
 * (`contributeCanvasKeys`), so any plugin may bind a canvas key as it binds
 * an outline one, and the page's one admission decides each context's
 * keymap. What a key does once a keymap holds it, and how a menu or a hint
 * shows it, is the keymap's (`canvas-keymap.ts`).
 */
import type { ContributionEntry } from "@kb/plugin";
import type { CanvasAlignEdge, CanvasOrder } from "./arrange.ts";
import type { CanvasFlipAxis } from "./transform.ts";

import type { CanvasProjectionKind } from "./camera.ts";
import type { Chord, KeyChordEvent, KeyContextSpec, Keybinding } from "@kb/keybindings";
import type { CanvasToolPick } from "./tool-model.ts";
import type { CanvasViewPresetName } from "@kb/contracts";
import { CANVAS_VIEW_PRESETS, ZOOM_STEP } from "./camera-stops.ts";
import type { CanvasAxis, TransformKey, TransformMode } from "./transform-input-model.ts";

/** A key event as the canvas reads it: the chord, and whether the key is held. */
export interface CanvasKeyEvent extends KeyChordEvent {
  /** Held down: the browser repeating the key. */
  repeat?: boolean;
}

export type CanvasIntent =
  | { type: "undo" }
  | { type: "redo" }
  | { type: "delete" }
  | { type: "selectAll" }
  | { type: "copy" }
  /** ⌘X: the selection copied, then deleted, as one change. */
  | { type: "cut" }
  | { type: "duplicate" }
  /** ↵: the one item selected opened for typing, as a double-click opens it. */
  | { type: "edit" }
  | { type: "escape" }
  | { type: "panModifier" }
  | { type: "nudge"; dx: number; dy: number }
  | { type: "tool"; tool: CanvasToolPick }
  | { type: "zoomBy"; factor: number }
  | { type: "zoomTo"; zoom: number }
  | { type: "frame"; scope: "all" | "selection" }
  | { type: "look"; preset: CanvasViewPresetName }
  | { type: "toggleLens" }
  | { type: "projection"; kind: CanvasProjectionKind }
  /** The canvas page in full screen, landscape where the platform lets it (`toggleFullscreen`); or out again. */
  | { type: "fullscreen" }
  | { type: "viewMenu" }
  /** The sheet that lists every shortcut. */
  | { type: "shortcuts" }
  | { type: "transform"; act: TransformAct }
  /** ⌘G: gather the selection into a group, a frame round it. */
  | { type: "group" }
  /** ⌘⇧G: take the selected groups apart. */
  | { type: "ungroup" }
  /** Look at a frame face-on: a frame is a viewpoint (plan decision 7). */
  | { type: "viewpoint"; id: string }
  /** Present mode: step through the canvas's frames, one viewpoint each. */
  | { type: "present"; act: PresentAct }
  /** The selection locked where it is, or unlocked when all of it is locked. */
  | { type: "lock" }
  /** The selection moved in the paint order (`orderItems`). */
  | { type: "order"; order: CanvasOrder }
  /** The selection mirrored (`flipItems`). */
  | { type: "flip"; axis: CanvasFlipAxis }
  /** The selection lined up on an edge of the box round it. */
  | { type: "align"; edge: CanvasAlignEdge }
  /** The selection spread evenly along an axis. */
  | { type: "distribute"; axis: CanvasFlipAxis }
  /** Where the one item selected leads (its `link`), followed. */
  | { type: "followLink" }
  /** The board's next page (1) or the one before it (-1). */
  | { type: "page"; step: 1 | -1 };

/** What a key does to present mode. */
export type PresentAct = "start" | "next" | "previous" | "stop";

/** What a key does to a modal transform. */
export type TransformAct =
  /** Begin one on the selection: G grab, S scale, E extrude. */
  | { kind: "begin"; mode: Exclude<TransformMode, "rotate"> }
  /** During one: an axis, a typed value, or another mode. */
  | { kind: "key"; key: TransformKey }
  /** During one: ⌘ or Ctrl went down, which suspends snapping. */
  | { kind: "free" }
  | { kind: "confirm" }
  | { kind: "cancel" };

/** What the camera can be asked to do: the view commands. */
type CanvasViewIntent = Extract<
  CanvasIntent,
  { type: "frame" | "look" | "toggleLens" | "projection" | "present" | "fullscreen" }
>;

/** The canvas's key contexts: at rest, in a modal transform, presenting frames. */
export type CanvasKeyContextName = "rest" | "transform" | "present";

/** Each context's id, as bindings name it: canvas-ui's namespace, then its own. */
export const CANVAS_CONTEXT_IDS: Readonly<Record<CanvasKeyContextName, string>> = {
  rest: "canvas.rest",
  transform: "canvas.transform",
  present: "canvas.present",
};

/** Where a shortcut is listed. */
export type CanvasShortcutSection =
  | "Tools"
  | "Edit"
  | "Arrange"
  | "Navigate"
  | "View"
  | "Transform"
  | "Present";

/**
 * One canvas shortcut, an intent of one context: its name (what a binding
 * runs), what it is called, where it is listed, the chords kb binds it to,
 * and what it asks for — an intent, one read off the key pressed, or null,
 * a claim with nothing to do.
 */
export interface CanvasShortcut {
  /** The intent's name, as a binding runs it; unique across the canvas's contexts. */
  readonly name: string;
  readonly label: string;
  readonly section: CanvasShortcutSection;
  /** The context whose keys run it. */
  readonly context: CanvasKeyContextName;
  /** The chords kb binds it to: canvas-ui's own bindings (`CANVAS_BINDINGS`). */
  readonly chords: readonly Chord[];
  readonly intent: CanvasIntent | null | ((event: CanvasKeyEvent) => CanvasIntent);
  /** Its keys in words, where its chords are too many to list one by one (`←↑→↓`). */
  readonly hintStyle?: "arrows";
  /**
   * Pressed with nothing selected, or nothing in it to act on (`acts`), it
   * does nothing: swallowed, or passed to the browser.
   */
  readonly needsSelection?: "swallow" | "pass";
  /** Whether the browser's default is prevented; Escape, for one, is left to it. */
  readonly prevent: boolean;
  /** In a modal transform, whether a held key acts again (Backspace); others act once. */
  readonly repeats?: boolean;
  /** The command menus that list it, and where (`menuRows`). */
  readonly menus?: CanvasMenuPlaces;
}

/** The canvas's command menus: the context menu on the selection and on empty canvas, and the zoom menu. */
export type CanvasMenuName = "selection" | "canvas" | "zoom";

/** Where a shortcut stands in each command menu that lists it: its row, then its place in the row. */
type CanvasMenuPlaces = Partial<Record<CanvasMenuName, readonly [row: number, at: number]>>;

/** A view command: a shortcut whose intent the camera carries out, listed in the view menu. */
export type CanvasViewCommand = CanvasShortcut & { readonly intent: CanvasViewIntent };

/** A letter matched in either case (Shift is its flag); any other key as named. */
function anyCase(key: string): Chord["key"] {
  const lower = key.toLowerCase();
  const upper = key.toUpperCase();
  return key.length === 1 && lower !== upper ? [lower, upper] : key;
}

/** `key` without ⌘ or Ctrl; Shift and ⌥ either way unless `more` says. */
const plain = (key: string, more: Chord = {}): Chord => ({
  key: anyCase(key),
  mod: false,
  ...more,
});

/** `key` with ⌘ or Ctrl, Shift up unless `more` says: ⌘⇧ makes a shortcut of its own. */
const command = (key: string, more: Chord = {}): Chord => ({
  key: anyCase(key),
  mod: true,
  shift: false,
  ...more,
});

/** `key` with or without ⌘ or Ctrl. */
const anyMod = (key: string, more: Chord = {}): Chord => ({ key: anyCase(key), ...more });

/** The key at the place `physicalKey`, without ⌘ or Ctrl. */
const at = (physicalKey: string, more: Chord = {}): Chord => ({ physicalKey, mod: false, ...more });

/** The key at the place `physicalKey` with Ctrl alone. */
const ctrlAt = (physicalKey: string): Chord => ({ physicalKey, ctrl: true, meta: false });

/** A shortcut of `section` in the canvas at rest, its defaults filled in. */
const inSection =
  (section: CanvasShortcutSection) =>
  (
    name: string,
    label: string,
    intent: CanvasShortcut["intent"],
    chords: readonly Chord[],
    more: Partial<Omit<CanvasShortcut, "name" | "section" | "label" | "intent" | "chords">> = {},
  ): CanvasShortcut => ({
    name,
    section,
    label,
    intent,
    chords,
    context: "rest",
    prevent: true,
    ...more,
  });

const edit = inSection("Edit");
const viewRow = inSection("View");
const navigate = inSection("Navigate");
const transformRow = inSection("Transform");

const view = (
  name: string,
  label: string,
  intent: CanvasViewIntent,
  chords: readonly Chord[],
  more: Partial<CanvasShortcut> = {},
): CanvasViewCommand => ({ ...viewRow(name, label, intent, chords, more), intent });

const look = (preset: CanvasViewPresetName, chords: readonly Chord[]) =>
  view(`look.${preset}`, CANVAS_VIEW_PRESETS[preset].label, { type: "look", preset }, chords);

/**
 * The view commands, in the view menu's order: Blender's numpad views (⌃ for
 * the opposite side; there is no view from under the floor), the lens, the
 * projections, framing (⇧1 and ⇧2 are tldraw's, numpad `.` Blender's),
 * presenting, and full screen.
 */
export const CANVAS_VIEW_COMMANDS: readonly CanvasViewCommand[] = [
  look("top", [at("Numpad7")]),
  look("front", [at("Numpad1")]),
  look("right", [at("Numpad3")]),
  look("back", [ctrlAt("Numpad1")]),
  look("left", [ctrlAt("Numpad3")]),
  look("oblique", []),
  view("lens", "Orthographic", { type: "toggleLens" }, [at("Numpad5")]),
  view("projection.2d", "2D", { type: "projection", kind: "2d" }, []),
  view("projection.3d", "3D", { type: "projection", kind: "3d" }, []),
  view(
    "frame.all",
    "Frame all",
    { type: "frame", scope: "all" },
    [at("Digit1", { shift: true }), plain("!", { shift: true })],
    { menus: { canvas: [2, 0], zoom: [1, 0] } },
  ),
  view(
    "frame.selection",
    "Frame selection",
    { type: "frame", scope: "selection" },
    [at("Digit2", { shift: true }), plain("@", { shift: true }), at("NumpadDecimal")],
    { needsSelection: "swallow", menus: { selection: [5, 0], zoom: [1, 1] } },
  ),
  view("present.start", "Present frames", { type: "present", act: "start" }, []),
  view("fullscreen", "Full screen", { type: "fullscreen" }, []),
];

/** A tool's shortcut: a key, or a chord where the key alone would claim another. G is not one: it grabs (plan decision 9). */
const tool = (label: string, pick: CanvasToolPick, chords: readonly (string | Chord)[]) =>
  inSection("Tools")(
    `tool.${pick}`,
    label,
    { type: "tool", tool: pick },
    chords.map((chord) => (typeof chord === "string" ? plain(chord) : chord)),
  );

/** An arrangement of the selection, pressed with ⌥ and a letter where the keyboard has it. */
const arrange = (
  name: string,
  label: string,
  intent: CanvasIntent,
  chords: readonly Chord[],
  menus?: CanvasMenuPlaces,
) => inSection("Arrange")(name, label, intent, chords, { needsSelection: "swallow", menus });

/** ⌥ and a letter, by its place: ⌥ makes another character of it on a Mac. */
const altKey = (letter: string, shift = false): Chord => at(`Key${letter}`, { alt: true, shift });

/** One canvas unit per arrow, ten with Shift held. */
const NUDGE_UNITS: Record<string, { dx: number; dy: number }> = {
  ArrowLeft: { dx: -1, dy: 0 },
  ArrowRight: { dx: 1, dy: 0 },
  ArrowUp: { dx: 0, dy: -1 },
  ArrowDown: { dx: 0, dy: 1 },
};

const nudge =
  (step: number) =>
  (event: CanvasKeyEvent): CanvasIntent => {
    const unit = NUDGE_UNITS[event.key] ?? { dx: 0, dy: 0 };
    return { type: "nudge", dx: unit.dx * step, dy: unit.dy * step };
  };

/**
 * An arrow with or without ⌘ or Ctrl, Shift as `shift` says: ⌥ with ← or →
 * and no ⌘ turns the page, so a nudge leaves that one to it.
 */
const nudgeChords = (shift: boolean): readonly Chord[] =>
  Object.keys(NUDGE_UNITS).flatMap((key) =>
    key === "ArrowLeft" || key === "ArrowRight"
      ? [
          { key, shift, alt: false },
          { key, shift, alt: true, mod: true },
        ]
      : [{ key, shift }],
  );

/** A modal transform's key act, as an intent. */
const act = (key: TransformKey): CanvasIntent => ({
  type: "transform",
  act: { kind: "key", key },
});

/** A modal transform's shortcut. */
const transform = (
  name: string,
  label: string,
  intent: CanvasShortcut["intent"],
  chords: readonly Chord[],
  more: Partial<CanvasShortcut> = {},
) =>
  transformRow(`transform.${name}`, label, intent, chords, {
    context: "transform",
    ...more,
  });

const axis = (name: CanvasAxis, plane: boolean) =>
  transform(
    `${plane ? "plane" : "axis"}.${name}`,
    plane ? `Across the plane off ${name.toUpperCase()}` : `Along ${name.toUpperCase()}`,
    act({ kind: "axis", axis: name, plane }),
    [plain(name, { shift: plane })],
  );

const switchTo = (mode: Exclude<TransformMode, "extrude">, key: string) =>
  transform(mode, `Switch to ${mode}`, act({ kind: "mode", mode }), [plain(key)]);

/** What a key types into a modal transform's value. */
const typed = (event: CanvasKeyEvent) => act({ kind: "type", key: event.key });

const present = (label: string, presentAct: PresentAct, chords: readonly Chord[]) =>
  inSection("Present")(
    `present.${presentAct}`,
    label,
    { type: "present", act: presentAct },
    chords,
    {
      context: "present",
      prevent: presentAct !== "stop",
    },
  );

/**
 * Every canvas shortcut, as the sheet lists them. While frames are
 * presented, present mode's keys are asked before the canvas's at rest (the
 * arrows step rather than nudge); a modal transform's keys are the only ones
 * asked while it runs.
 */
export const CANVAS_SHORTCUTS: readonly CanvasShortcut[] = [
  transform(
    "cancel",
    "Cancel",
    { type: "transform", act: { kind: "cancel" } },
    [anyMod("Escape")],
    {
      prevent: false,
    },
  ),
  transform("confirm", "Confirm", { type: "transform", act: { kind: "confirm" } }, [
    anyMod("Enter"),
  ]),
  transform(
    "free",
    "Free of snapping (hold)",
    { type: "transform", act: { kind: "free" } },
    [anyMod("Meta"), anyMod("Control")],
    { prevent: false },
  ),
  axis("x", false),
  axis("y", false),
  axis("z", false),
  axis("x", true),
  axis("y", true),
  axis("z", true),
  switchTo("grab", "g"),
  switchTo("rotate", "r"),
  switchTo("scale", "s"),
  transform(
    "type",
    "Type a value",
    typed,
    "0123456789.-".split("").map((key) => plain(key)),
  ),
  transform("erase", "Erase a typed digit", typed, [plain("Backspace")], { repeats: true }),
  present("Next frame", "next", [
    plain("ArrowRight"),
    plain("ArrowDown"),
    plain("PageDown"),
    plain(" ", { shift: false }),
  ]),
  present("Previous frame", "previous", [
    plain("ArrowLeft"),
    plain("ArrowUp"),
    plain("PageUp"),
    plain(" ", { shift: true }),
  ]),
  present("Stop presenting", "stop", [plain("Escape")]),
  edit(
    "redo",
    "Redo",
    { type: "redo" },
    [command("z", { shift: true }), { key: "Z", mod: true, shift: false }, command("y")],
    { menus: { canvas: [0, 1] } },
  ),
  // A capital Z with ⌘ and no Shift (Caps Lock) is the redo's.
  edit("undo", "Undo", { type: "undo" }, [{ key: "z", mod: true, shift: false }], {
    menus: { canvas: [0, 0] },
  }),
  ...CANVAS_VIEW_COMMANDS,
  // ⌃numpad 7 would look from under the floor: there is no such view, so it does nothing.
  viewRow("look.under", "", null, [ctrlAt("Numpad7")]),
  viewRow("view-menu", "View menu", { type: "viewMenu" }, [at("Backquote")]),
  viewRow("shortcuts", "Keyboard shortcuts", { type: "shortcuts" }, [plain("?")]),
  edit("delete", "Delete", { type: "delete" }, [anyMod("Delete"), anyMod("Backspace")], {
    needsSelection: "swallow",
    menus: { selection: [1, 3] },
  }),
  edit("select-all", "Select all", { type: "selectAll" }, [command("a")], {
    menus: { canvas: [1, 0] },
  }),
  // ⌘V is not the canvas's: the browser's paste event carries what the clipboard holds.
  edit("copy", "Copy", { type: "copy" }, [command("c")], {
    needsSelection: "swallow",
    menus: { selection: [1, 1] },
  }),
  edit("cut", "Cut", { type: "cut" }, [command("x")], {
    needsSelection: "swallow",
    menus: { selection: [1, 0] },
  }),
  edit("group", "Group into a frame", { type: "group" }, [command("g")], {
    needsSelection: "swallow",
    menus: { selection: [2, 0] },
  }),
  edit("ungroup", "Ungroup", { type: "ungroup" }, [command("g", { shift: true })], {
    needsSelection: "swallow",
    menus: { selection: [2, 1] },
  }),
  edit("duplicate", "Duplicate", { type: "duplicate" }, [command("d")], {
    needsSelection: "swallow",
    menus: { selection: [1, 2] },
  }),
  edit("lock", "Lock or unlock", { type: "lock" }, [plain("l", { shift: true })], {
    needsSelection: "swallow",
    menus: { selection: [2, 2] },
  }),
  navigate("follow-link", "Follow link", { type: "followLink" }, [command("Enter")], {
    needsSelection: "swallow",
    menus: { selection: [0, 1] },
  }),
  // tldraw's: ↵ types into what is selected, as a double-click does.
  edit("edit", "Edit its words", { type: "edit" }, [plain("Enter", { shift: false })], {
    needsSelection: "pass",
    menus: { selection: [0, 0] },
  }),
  // tldraw's: ⌥ and an arrow turns the page, so it does not nudge.
  navigate("page.next", "Next page", { type: "page", step: 1 }, [
    plain("ArrowRight", { alt: true }),
  ]),
  navigate("page.previous", "Previous page", { type: "page", step: -1 }, [
    plain("ArrowLeft", { alt: true }),
  ]),
  arrange("order.forward", "Forward one step", { type: "order", order: "forward" }, [
    at("BracketRight", { alt: true }),
  ]),
  arrange("order.backward", "Backward one step", { type: "order", order: "backward" }, [
    at("BracketLeft", { alt: true }),
  ]),
  arrange(
    "order.front",
    "Bring to front",
    { type: "order", order: "front" },
    [at("BracketRight", { alt: false })],
    { selection: [3, 0] },
  ),
  arrange(
    "order.back",
    "Send to back",
    { type: "order", order: "back" },
    [at("BracketLeft", { alt: false })],
    { selection: [3, 1] },
  ),
  arrange("distribute.x", "Spread across evenly", { type: "distribute", axis: "x" }, [
    altKey("H", true),
  ]),
  arrange("distribute.y", "Spread down evenly", { type: "distribute", axis: "y" }, [
    altKey("V", true),
  ]),
  arrange("align.left", "Align left", { type: "align", edge: "left" }, [altKey("A")]),
  arrange("align.centre", "Align centres across", { type: "align", edge: "centre" }, [altKey("H")]),
  arrange("align.right", "Align right", { type: "align", edge: "right" }, [altKey("D")]),
  arrange("align.top", "Align top", { type: "align", edge: "top" }, [altKey("W")]),
  arrange("align.middle", "Align middles down", { type: "align", edge: "middle" }, [altKey("V")]),
  arrange("align.bottom", "Align bottom", { type: "align", edge: "bottom" }, [altKey("S")]),
  arrange(
    "flip.x",
    "Flip left for right",
    { type: "flip", axis: "x" },
    [plain("h", { shift: true, alt: false })],
    { selection: [4, 0] },
  ),
  arrange(
    "flip.y",
    "Flip top for bottom",
    { type: "flip", axis: "y" },
    [plain("v", { shift: true, alt: false })],
    { selection: [4, 1] },
  ),
  edit("step-out", "Step out", { type: "escape" }, [anyMod("Escape")], {
    prevent: false,
  }),
  viewRow("pan", "Pan (hold)", { type: "panModifier" }, [{ physicalKey: "Space" }]),
  edit("nudge", "Nudge", nudge(1), nudgeChords(false), {
    needsSelection: "pass",
    hintStyle: "arrows",
  }),
  edit("nudge.ten", "Nudge ten", nudge(10), nudgeChords(true), {
    needsSelection: "pass",
    hintStyle: "arrows",
  }),
  transformRow(
    "grab",
    "Grab",
    { type: "transform", act: { kind: "begin", mode: "grab" } },
    [plain("g", { shift: false })],
    { needsSelection: "swallow" },
  ),
  transformRow(
    "scale",
    "Scale",
    { type: "transform", act: { kind: "begin", mode: "scale" } },
    [plain("s", { shift: false })],
    { needsSelection: "swallow" },
  ),
  transformRow(
    "extrude",
    "Extrude",
    { type: "transform", act: { kind: "begin", mode: "extrude" } },
    [plain("e", { shift: false })],
    { needsSelection: "swallow" },
  ),
  // ⇧V and ⇧H flip the selection: the tools take them only with ⌥ too.
  tool("Select", "select", [
    plain("v", { shift: false }),
    plain("v", { shift: true, alt: true }),
    "1",
  ]),
  tool("Hand", "hand", [plain("h", { shift: false }), plain("h", { shift: true, alt: true })]),
  tool("Text", "text", ["t", "2"]),
  tool("Rectangle", "rect", ["r", "3"]),
  tool("Ellipse", "ellipse", ["o", "c", "4"]),
  // ⇧D is the highlighter's, as tldraw's.
  tool("Diamond", "diamond", [plain("d", { shift: false }), "5"]),
  tool("Draw", "draw", ["p"]),
  tool("Highlight", "highlight", [plain("d", { shift: true })]),
  // ⇧L locks.
  tool("Line", "line", [plain("l", { shift: false })]),
  tool("Arrow", "arrow", ["a"]),
  tool("Card for a node", "kb-node", ["n", "6"]),
  tool("Frame", "group", ["f", "7"]),
  tool("Solid (the last one made)", "solid", ["b", "8"]),
  tool("Comment", "comment", ["m"]),
  viewRow(
    "zoom.in",
    "Zoom in",
    { type: "zoomBy", factor: ZOOM_STEP },
    [command("="), command("+")],
    { menus: { zoom: [0, 0] } },
  ),
  viewRow("zoom.out", "Zoom out", { type: "zoomBy", factor: 1 / ZOOM_STEP }, [command("-")], {
    menus: { zoom: [0, 1] },
  }),
  viewRow("zoom.reset", "Zoom to 100%", { type: "zoomTo", zoom: 1 }, [command("0")], {
    menus: { canvas: [2, 1], zoom: [0, 2] },
  }),
];

/**
 * The canvas's key contexts, as canvas-ui contributes them to
 * `ui.key-contexts`: each offered the keys of the canvas while it has them,
 * its intents its shortcuts, and Escape its own, so no binding traps a
 * person in a transform or a presentation.
 */
const CANVAS_CONTEXTS: readonly ContributionEntry<KeyContextSpec>[] = (
  ["rest", "transform", "present"] as const
).map((name) => ({
  id: name,
  value: {
    reach: "surface",
    intents: CANVAS_SHORTCUTS.filter(({ context }) => context === name).map((s) => s.name),
    reserved: [{ key: "Escape" }],
  },
}));

/**
 * The canvas's keys, as canvas-ui's contributions to `ui.keybindings`: one
 * binding per chord of each shortcut, `canvas.rest.tool.select`,
 * `canvas.rest.tool.select.2`, … No two of a context's chords overlap.
 */
const CANVAS_BINDINGS: readonly ContributionEntry<Keybinding>[] = CANVAS_SHORTCUTS.flatMap(
  (entry) =>
    entry.chords.map((chord, index) => ({
      id: `${entry.context}.${entry.name}${index === 0 ? "" : `.${index + 1}`}`,
      value: { context: CANVAS_CONTEXT_IDS[entry.context], chord, run: { intent: entry.name } },
    })),
);

export const CANVAS_KEYBOARD = { contexts: CANVAS_CONTEXTS, bindings: CANVAS_BINDINGS };
