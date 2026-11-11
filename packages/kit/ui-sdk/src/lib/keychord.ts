/**
 * Chord matching, once, for every keymap.
 *
 * A chord is a set of optional constraints: a constraint that is absent is
 * not asked about, so `{ key: "Enter" }` claims Enter with or without Shift,
 * and `{ alt: false }` claims only the unmodified form. A local keymap (a
 * picker's, a value slot's) is a list of `{ chord, … }` rows resolved
 * first-match by {@link lookupChord}, exactly the order an `if`/`switch`
 * chain resolves in. The outline's two keymaps are bindings to
 * `ui.keybindings` instead (`./keybindings`), whose chords may not overlap
 * ({@link chordsOverlap}), so their order means nothing.
 *
 * Every keymap reads this module rather than testing `event.metaKey`
 * itself: "does this event match this chord" is one question, so it has one
 * answer.
 *
 * A chord names its key by character (`key`, as `KeyboardEvent.key` names
 * it) or by place (`code`, as `KeyboardEvent.code` names it: `Numpad7`,
 * `KeyH`, `BracketLeft`), where the place is what counts: a numpad digit is
 * not the row's, and ⌥ makes another character of a letter on a Mac. One
 * press has both, and which character a place types is the layout's, so a
 * chord by place may overlap a character chord under some layout. Reservations
 * must protect that shared press; within a context, a keymap asks its chords by place first ({@link placeFirst}).
 */

/** The parts of a keyboard event a chord is allowed to look at. */
export interface KeyChordEvent {
  key: string;
  /** The key's place on the keyboard (`KeyboardEvent.code`); absent, no chord by place matches. */
  code?: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}

/** One key, several spellings of one key, or a predicate over the name. */
type KeyMatch = string | readonly string[] | ((key: string) => boolean);

export interface Chord {
  /** Absent ⇒ any key; the modifier constraints then carry the whole chord. */
  key?: KeyMatch;
  /** The key's place (`KeyboardEvent.code`): a chord that names one is a chord by place. */
  code?: string;
  /**
   * `metaKey || ctrlKey` — the platform-agnostic "command" modifier.
   *
   * {@link Chord.meta} exists beside it because the editing keymap
   * distinguishes them: ⌘⇧↑ reorders a row while ⌃⇧↑ collapses it. Ask with
   * `mod` unless a binding genuinely means the Command key, or {@link
   * Chord.ctrl} the Control key.
   */
  mod?: boolean;
  meta?: boolean;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
}

/** A single-character key name — the printable fall-through both maps use. */
export function isPrintableKey(key: string): boolean {
  return key.length === 1;
}

function keyMatches(match: KeyMatch | undefined, key: string): boolean {
  if (match === undefined) return true;
  if (typeof match === "string") return match === key;
  if (typeof match === "function") return match(key);
  return match.includes(key);
}

function flagMatches(required: boolean | undefined, actual: boolean): boolean {
  return required === undefined || required === actual;
}

/** The four modifiers a chord constrains, as an event holds them. */
interface Modifiers {
  readonly meta: boolean;
  readonly ctrl: boolean;
  readonly shift: boolean;
  readonly alt: boolean;
}

function modifiersMatch(chord: Chord, mods: Modifiers): boolean {
  return (
    flagMatches(chord.mod, mods.meta || mods.ctrl) &&
    flagMatches(chord.meta, mods.meta) &&
    flagMatches(chord.ctrl, mods.ctrl) &&
    flagMatches(chord.shift, mods.shift) &&
    flagMatches(chord.alt, mods.alt)
  );
}

/** Whether `chord` names its key by place (`code`) rather than by character. */
export function byPlace(chord: Chord): boolean {
  return chord.code !== undefined;
}

/** True when `ev` satisfies every constraint the chord states. */
export function matchesChord(ev: KeyChordEvent, chord: Chord): boolean {
  return (
    (chord.code === undefined || chord.code === ev.code) &&
    keyMatches(chord.key, ev.key) &&
    modifiersMatch(chord, {
      meta: ev.metaKey === true,
      ctrl: ev.ctrlKey === true,
      shift: ev.shiftKey === true,
      alt: ev.altKey === true,
    })
  );
}

/** Every state the four modifiers can be in: 16, so overlap is decided exactly. */
const MODIFIER_STATES: readonly Modifiers[] = Array.from({ length: 16 }, (_, bits) => ({
  meta: (bits & 1) !== 0,
  ctrl: (bits & 2) !== 0,
  shift: (bits & 4) !== 0,
  alt: (bits & 8) !== 0,
}));

/** The key names a match lists, or null for one that lists none (any key, a predicate). */
function listedKeys(match: KeyMatch | undefined): readonly string[] | null {
  if (match === undefined || typeof match === "function") return null;
  return typeof match === "string" ? [match] : match;
}

/**
 * Whether two key matches admit a common key. Listed names are compared
 * exactly; a listed name against a predicate asks the predicate; two
 * matches that list nothing (any key, or two predicates) are taken to
 * overlap, since no finite check can tell them apart.
 */
function keysOverlap(a: KeyMatch | undefined, b: KeyMatch | undefined): boolean {
  const listedA = listedKeys(a);
  const listedB = listedKeys(b);
  if (listedA !== null) return listedA.some((key) => keyMatches(b, key));
  if (listedB !== null) return listedB.some((key) => keyMatches(a, key));
  return true;
}

/** Layout-independent numpad meanings; NumLock changes the same physical digit's key. */
const NUMPAD_KEYS: Readonly<Record<string, readonly string[]>> = {
  Numpad0: ["0", "Insert"],
  Numpad1: ["1", "End"],
  Numpad2: ["2", "ArrowDown"],
  Numpad3: ["3", "PageDown"],
  Numpad4: ["4", "ArrowLeft"],
  Numpad5: ["5", "Clear"],
  Numpad6: ["6", "ArrowRight"],
  Numpad7: ["7", "Home"],
  Numpad8: ["8", "ArrowUp"],
  Numpad9: ["9", "PageUp"],
  NumpadDecimal: [".", ",", "Delete"],
  NumpadEnter: ["Enter"],
  NumpadAdd: ["+"],
  NumpadSubtract: ["-"],
  NumpadMultiply: ["*"],
  NumpadDivide: ["/"],
};

const layoutCharacter = (key: string) =>
  isPrintableKey(key) || key === "Dead" || key === "Unidentified";

/** A known code narrows its key domain; layout-dependent positions remain conservative. */
function keyDomain(chord: Chord): KeyMatch | undefined {
  if (chord.key !== undefined || chord.code === undefined) return chord.key;
  const numpad = NUMPAD_KEYS[chord.code];
  if (numpad !== undefined) return numpad;
  if (chord.code === "Space") return " ";
  if (
    /^(Key[A-Z]|Digit[0-9]|BracketLeft|BracketRight|Backslash|IntlBackslash|IntlRo|IntlYen|Minus|Equal|Semicolon|Quote|Backquote|Comma|Period|Slash)$/.test(
      chord.code,
    )
  )
    return layoutCharacter;
  if (
    /^(Escape|Enter|Tab|Backspace|Delete|Insert|Home|End|PageUp|PageDown|Arrow(Up|Down|Left|Right)|F[0-9]+)$/.test(
      chord.code,
    )
  )
    return chord.code;
  return undefined;
}

/**
 * Whether one key event could match both chords: they admit a common key,
 * and some state of the four modifiers satisfies both. A keymap whose
 * chords never overlap means the same in any order. Unknown layout mappings
 * are conservative: a code constraint cannot prove a character disjoint.
 */
export function chordsOverlap(a: Chord, b: Chord): boolean {
  if (a.code !== undefined && b.code !== undefined && a.code !== b.code) return false;
  return (
    keysOverlap(keyDomain(a), keyDomain(b)) &&
    MODIFIER_STATES.some((mods) => modifiersMatch(a, mods) && modifiersMatch(b, mods))
  );
}

/** Whether every press of `part` is also claimed by `whole`; unknown predicates stay conservative. */
export function chordIncludes(whole: Chord, part: Chord): boolean {
  const keys = listedKeys(part.key);
  const includesKeys =
    whole.key === undefined ||
    whole.key === part.key ||
    (keys !== null && keys.every((key) => keyMatches(whole.key, key)));
  return (
    (whole.code === undefined || whole.code === part.code) &&
    includesKeys &&
    MODIFIER_STATES.every((mods) => !modifiersMatch(part, mods) || modifiersMatch(whole, mods))
  );
}

const MODIFIER_TOKENS = ["Mod", "Meta", "Ctrl", "Shift", "Alt"] as const;
type ModifierToken = (typeof MODIFIER_TOKENS)[number];

function isModifierToken(token: string): token is ModifierToken {
  return MODIFIER_TOKENS.some((name) => name === token);
}

/**
 * A chord written as data, `Mod-Shift-ArrowUp`: modifiers, then a key as
 * `KeyboardEvent.key` names it, joined by `-` (the key `-` itself is
 * written last, `Ctrl--`). The chord is exact: a modifier it does not name
 * must be up, so `Alt-ArrowUp` is not `Alt-Shift-ArrowUp`. `Mod` is the
 * platform's command modifier (⌘ or Ctrl). A letter matches in either
 * case, since the case an event carries with a modifier held differs by
 * platform (⌘⇧S arrives as `s` on macOS): Shift is its flag, never its
 * case. Null for text that is not a chord: an unknown or repeated
 * modifier, or no key.
 */
export function parseChord(text: string): Chord | null {
  const keyPart = text.endsWith("--") ? "-" : text.slice(text.lastIndexOf("-") + 1);
  const modifierPart = text.slice(0, text.length - keyPart.length);
  const tokens = modifierPart === "" ? [] : modifierPart.slice(0, -1).split("-");
  if (keyPart === "" || !tokens.every(isModifierToken)) return null;
  if (new Set(tokens).size !== tokens.length) return null;
  const has = (token: ModifierToken): boolean => tokens.includes(token);
  if (has("Mod") && (has("Meta") || has("Ctrl"))) return null;
  const shift = has("Shift");
  const lower = keyPart.toLowerCase();
  const upper = keyPart.toUpperCase();
  const key = keyPart.length === 1 && lower !== upper ? [lower, upper] : keyPart;
  return has("Mod")
    ? { key, mod: true, shift, alt: has("Alt") }
    : { key, meta: has("Meta"), ctrl: has("Ctrl"), shift, alt: has("Alt") };
}

/** A key match as a person reads it: a letter matched in either case reads as the letter. */
function keyName(key: KeyMatch | undefined): string {
  if (key === undefined) return "any key";
  if (typeof key === "function") return "a typed character";
  const names = [key].flat();
  const [first, second] = names;
  if (names.length === 2 && first !== undefined && first.toUpperCase() === second) return first;
  return names.join("/");
}

/** A chord as a person reads it in a message: its constraints, `Mod-Shift-ArrowUp`. */
export function describeChord(chord: Chord): string {
  const flags: string[] = [];
  if (chord.mod === true) flags.push("Mod");
  if (chord.meta === true) flags.push("Meta");
  if (chord.ctrl === true) flags.push("Ctrl");
  if (chord.shift === true) flags.push("Shift");
  if (chord.alt === true) flags.push("Alt");
  return [...flags, chord.code === undefined ? keyName(chord.key) : `[${chord.code}]`].join("-");
}

/**
 * The text host's own undo and redo, ⌘Z and ⌘⇧Z (`NodeTextHost`): a row's
 * history is never a binding's, so no keymap may take it.
 */
export const TEXT_HISTORY_CHORD: Chord = { key: ["z", "Z"], mod: true, alt: false };

/** The palette's ⌘K: the page's own key (`core.page`), which no other key context may take. */
export const PALETTE_CHORD: Chord = { key: ["k", "K"], mod: true };

/** Anything a keymap table holds: a chord, plus whatever the map does with it. */
interface ChordBinding {
  readonly chord: Chord;
}

/**
 * The first binding whose chord matches, or undefined: the first by place,
 * else the first by character.
 *
 * `accepts` is the second half of a row's condition for maps whose rows depend
 * on more than the event — the editing map's reference guard asks about the
 * caret. A row the predicate rejects is skipped, so the search continues down
 * the table exactly as a failed `if` continues down a chain.
 */
export function lookupChord<B extends ChordBinding>(
  ev: KeyChordEvent,
  bindings: readonly B[],
  accepts: (binding: B) => boolean = () => true,
): B | undefined {
  const asked = (place: boolean) =>
    bindings.find(
      (binding) =>
        byPlace(binding.chord) === place && matchesChord(ev, binding.chord) && accepts(binding),
    );
  return asked(true) ?? asked(false);
}
