/**
 * Keybindings as a point: a key in a context runs an intent the context
 * names, or an action (DESIGN-UI.md → Keybindings).
 *
 * A context is a place keys mean something, owned by the plugin that
 * reads it: the outline's editing row (`outline.editing`) and its
 * selection (`outline.selection`). Its owner states its bindings as every
 * other plugin does, as contributions to {@link KeybindingPoint}, so a
 * built-in has an id another binding can name. The keymap a context reads
 * is decided here, once, for every context: the owner's bindings first,
 * then the rest in the order they were contributed. A binding whose chord
 * overlaps one already held is refused, unless it says it `replaces` that
 * holder; a reserved chord is the owner's alone. A refusal is told to the
 * person, by name, once a page session.
 */
import type { ContributionEntry, Contribution } from "@kb/plugin";
import { Point } from "@kb/plugin";
import { chordsOverlap, describeChord, matchesChord, parseChord } from "./keychord";
import type { Chord, KeyChordEvent } from "./keychord";
import { pointReader } from "./plugins";
import { toast } from "./toast";

/** What a key runs: an intent of its context, by name, or an action, through the invoke path. */
export type KeyRun =
  | { readonly intent: string }
  | {
      readonly action: string;
      /** The action's input; the row's node is added as `id`. */
      readonly input?: Readonly<Record<string, unknown>>;
    };

/** A key in a context, and what it runs. */
export interface Keybinding {
  /** The context it is a key of, by id (`KeyContext.id`). */
  readonly context: string;
  readonly chord: Chord;
  readonly run: KeyRun;
  /** The binding whose chord this one takes, by its namespaced id. */
  readonly replaces?: string;
}

export const KeybindingPoint = Point<Keybinding>()("ui.keybindings", {
  cardinality: "keyed",
  combine:
    "one binding per chord per context: the context owner's first, then load order; an overlapping or reserved chord is refused unless the binding replaces its holder",
  kernel: "page",
  tier: "T0",
});

/** The contexts a binding may name: the outline's row being edited, and its selection. */
export type KeyContextId = "outline.editing" | "outline.selection";

/**
 * A binding as data (its T0 form): a chord written as text
 * (`Alt-ArrowUp`, {@link parseChord}), the context it is a key of, what it
 * runs, and the binding it replaces, if it takes a held chord. A chord
 * that is not one throws, as a malformed contribution should, where its
 * plugin applies.
 */
export function provideKeybinding(
  id: string,
  binding: {
    readonly context: KeyContextId;
    readonly chord: string;
    readonly run: KeyRun;
    readonly replaces?: string;
  },
): ContributionEntry<Keybinding> {
  const chord = parseChord(binding.chord);
  if (chord === null) throw new Error(`keybinding ${id}: "${binding.chord}" is not a chord`);
  return { id, value: { ...binding, chord } };
}

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
  if ("intent" in value.run && !context.intents.includes(value.run.intent)) {
    return `${context.id} has no intent "${value.run.intent}"`;
  }
  if (owner !== context.owner && context.reserved.some((r) => chordsOverlap(r, value.chord))) {
    return `${chord} is reserved in ${context.id}`;
  }
  const overlapping = held.filter((other) => chordsOverlap(other.value.chord, value.chord));
  const taken = overlapping.find((other) => other.id !== value.replaces);
  if (taken !== undefined) {
    return `${chord} in ${context.id} is held by ${taken.id}; a binding that takes it says replaces: "${taken.id}"`;
  }
  if (value.replaces !== undefined && overlapping.length === 0) {
    return `it replaces ${value.replaces}, which holds no chord overlapping ${chord} in ${context.id}`;
  }
  return null;
}

/**
 * The keymap of `context` over the contributions to {@link KeybindingPoint}:
 * those naming it, the owner's first, each admitted unless its chord
 * overlaps one held or reserved and it does not replace the holder. A key
 * resolves to the binding replacing another where both match, so a
 * replacement takes exactly the chord it names and its holder keeps the rest.
 * The kernel admitted each binding by its id alone, so a refused one stays
 * contributed and inert: GAP [[01M6Y9H5FD9GVMK9N9QBT5DNTN]].
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
    resolve: (ev) => {
      const matching = held.filter(({ value }) => matchesChord(ev, value.chord));
      return matching.find(({ value }) => value.replaces !== undefined) ?? matching[0];
    },
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
