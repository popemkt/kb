/**
 * Keybindings as a point: a key in a context runs an intent the context
 * names (DESIGN-UI.md → Keybindings).
 *
 * A context is a place keys mean something, owned by the plugin that
 * reads it: the outline's editing row (`outline.editing`) and its
 * selection (`outline.selection`). Its owner states its bindings as every
 * other plugin does, as contributions to {@link KeybindingPoint}, so a
 * built-in has an id. The keymap a context reads is decided here, once,
 * for every context: the owner's bindings first, then the rest in the
 * order they were contributed. A binding whose chord overlaps one already
 * held is refused, and a reserved chord is the owner's alone. A refusal is
 * told to the person, by name, once a page session.
 */
import type { Contribution } from "@kb/plugin";
import { Point } from "@kb/plugin";
import { chordsOverlap, describeChord, matchesChord } from "./keychord";
import type { Chord, KeyChordEvent } from "./keychord";
import { pointReader } from "./plugins";
import { toast } from "./toast";

/** What a key runs: an intent of its context, by name. */
export interface KeyRun {
  readonly intent: string;
}

/** A key in a context, and what it runs. */
export interface Keybinding {
  /** The context it is a key of, by id (`KeyContext.id`). */
  readonly context: string;
  readonly chord: Chord;
  readonly run: KeyRun;
}

export const KeybindingPoint = Point<Keybinding>()("ui.keybindings", {
  cardinality: "keyed",
  combine:
    "one binding per chord per context: the context owner's first, then load order; an overlapping or reserved chord is refused",
  kernel: "page",
  tier: "T0",
});

/** The contexts a binding may name: the outline's row being edited, and its selection. */
export type KeyContextId = "outline.editing" | "outline.selection";

/** A context as its owner states it: what its bindings may run, and what no other plugin may take. */
export interface KeyContext {
  readonly id: KeyContextId;
  /** The plugin that reads the context: its bindings are held first, and may hold a reserved chord. */
  readonly owner: string;
  /** The intents a binding may run, by name. */
  readonly intents: readonly string[];
  /** Chords only the owner may bind. */
  readonly reserved: readonly Chord[];
}

/** A binding the keymap did not admit, and why, in words. */
export interface RefusedBinding {
  readonly id: string;
  readonly reason: string;
}

/** A context's keymap: the binding a key event resolves to, and what was refused. */
export interface Keymap {
  readonly resolve: (ev: KeyChordEvent) => Contribution<Keybinding> | undefined;
  readonly refused: readonly RefusedBinding[];
}

/** Why `binding` may not join `held`, or null when it may. */
function refusal(
  context: KeyContext,
  held: readonly Contribution<Keybinding>[],
  { owner, value }: Contribution<Keybinding>,
): string | null {
  const chord = describeChord(value.chord);
  if (!context.intents.includes(value.run.intent)) {
    return `${context.id} has no intent "${value.run.intent}"`;
  }
  if (owner !== context.owner && context.reserved.some((r) => chordsOverlap(r, value.chord))) {
    return `${chord} is reserved in ${context.id}`;
  }
  const taken = held.find((other) => chordsOverlap(other.value.chord, value.chord));
  return taken === undefined ? null : `${chord} in ${context.id} is held by ${taken.id}`;
}

/**
 * The keymap of `context` over the contributions to {@link KeybindingPoint}:
 * those naming it, the owner's first, each admitted unless its chord
 * overlaps one held or reserved. Admitted chords never overlap, so a key
 * resolves to at most one binding.
 */
export function admitKeybindings(
  context: KeyContext,
  contributions: readonly Contribution<Keybinding>[],
): Keymap {
  const named = contributions.filter(({ value }) => value.context === context.id);
  const ordered = [
    ...named.filter(({ owner }) => owner === context.owner),
    ...named.filter(({ owner }) => owner !== context.owner),
  ];
  const held: Contribution<Keybinding>[] = [];
  const refused: RefusedBinding[] = [];
  for (const binding of ordered) {
    const reason = refusal(context, held, binding);
    if (reason === null) held.push(binding);
    else refused.push({ id: binding.id, reason });
  }
  return {
    refused,
    resolve: (ev) => held.find(({ value }) => matchesChord(ev, value.chord)),
  };
}

const readBindings = pointReader(KeybindingPoint);
const keymaps = new WeakMap<readonly Contribution<Keybinding>[], Map<KeyContextId, Keymap>>();
const told = new Set<string>();

/**
 * The keymap of `context` now, over the page kernel's bindings: computed
 * once per change to the kernel, and each refusal told once a page
 * session, naming the binding and why.
 */
export function currentKeymap(context: KeyContext): Keymap {
  const bindings = readBindings();
  const byContext = keymaps.get(bindings) ?? new Map<KeyContextId, Keymap>();
  keymaps.set(bindings, byContext);
  const cached = byContext.get(context.id);
  if (cached !== undefined) return cached;
  const keymap = admitKeybindings(context, bindings);
  byContext.set(context.id, keymap);
  for (const { id, reason } of keymap.refused) {
    const line = `Keybinding ${id} refused: ${reason}`;
    if (told.has(line)) continue;
    told.add(line);
    toast(line);
  }
  return keymap;
}
