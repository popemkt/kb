/**
 * Keybindings as a point: a key in a context runs an intent the context
 * names, or an action (DESIGN-UI.md → Keybindings).
 *
 * A context is a place keys mean something, a contribution to
 * {@link KeyContextPoint} by the plugin that reads it, which owns it: the
 * outline's editing row (`outline.editing`) and its selection
 * (`outline.selection`). Its owner states its bindings as every other
 * plugin does, as contributions to {@link KeybindingPoint}, so a built-in
 * has an id another binding can name. The keymap a context reads is
 * decided here, once, for every context: the owner's bindings first,
 * then the rest in the order they were contributed. A binding whose chord
 * overlaps one already held is refused, unless it says it `replaces` that
 * holder and the host approves its owner replacing (`replacementApproved`);
 * a reserved chord is the owner's alone. A refusal is told to the person,
 * by name, once a page session.
 */
import { CORE_POINT_DEFINITIONS } from "@kb/contracts";
import type { ContributionEntry, Contribution } from "@kb/plugin";
import { Point } from "@kb/plugin";
import { chordsOverlap, describeChord, matchesChord, parseChord } from "./keychord";
import type { Chord, KeyChordEvent } from "./keychord";
import { browserHost } from "../host";
import type { ActionCall } from "./action-call";
import { pointReader } from "./plugins";
import { toast } from "./toast";

/** What a key runs: an intent of its context, by name, or an action, through the invoke path. */
export type KeyRun = { readonly intent: string } | ActionCall;

/** A key in a context, and what it runs. */
export interface Keybinding {
  /** The context it is a key of, by id (`KeyContext.id`). */
  readonly context: string;
  readonly chord: Chord;
  readonly run: KeyRun;
  /** The binding whose chord this one takes, by its namespaced id. */
  readonly replaces?: string;
}

export const KeybindingPoint = Point<Keybinding>()(
  CORE_POINT_DEFINITIONS.keybinding.name,
  CORE_POINT_DEFINITIONS.keybinding.spec,
);

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

/** A context as its owner contributes it: what its bindings may run, and what no other plugin may take. */
export interface KeyContextSpec {
  /** The intents a binding may run, by name. */
  readonly intents: readonly string[];
  /** Chords only the owner may bind. */
  readonly reserved: readonly Chord[];
}

export const KeyContextPoint = Point<KeyContextSpec>()(
  CORE_POINT_DEFINITIONS.keyContext.name,
  CORE_POINT_DEFINITIONS.keyContext.spec,
);

/**
 * A context as the keymap reads it: its id, the contribution's, and its
 * owner, the plugin that contributed it, whose bindings are held first and
 * may hold a reserved chord.
 */
export interface KeyContext extends KeyContextSpec {
  readonly id: string;
  readonly owner: string;
}

/** The context a contribution to {@link KeyContextPoint} states. */
export function keyContextOf({ id, owner, value }: Contribution<KeyContextSpec>): KeyContext {
  return { ...value, id, owner };
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

/**
 * The bindings `id` stands on: itself, the one it replaces, the one that
 * one replaces, and so on, among `held`. A key a binding of the chain
 * takes is still answered by the chain, by its newest member.
 */
function chainOf(id: string | undefined, held: readonly Contribution<Keybinding>[]): Set<string> {
  const chain = new Set<string>();
  let at = held.find((binding) => binding.id === id);
  while (at !== undefined && !chain.has(at.id)) {
    chain.add(at.id);
    const below = at.value.replaces;
    at = held.find((binding) => binding.id === below);
  }
  return chain;
}

/**
 * Why `binding` may not join `held`, or null when it may. Every held
 * binding its chord overlaps must be the one it replaces or one that
 * binding stands on ({@link chainOf}), so the bindings any one key event
 * matches are always one chain, each newer than the one it replaces.
 */
function refusal(
  context: KeyContext,
  held: readonly Contribution<Keybinding>[],
  { owner, value }: Contribution<Keybinding>,
  approved: (owner: string) => boolean,
): string | null {
  const chord = describeChord(value.chord);
  if ("intent" in value.run && !context.intents.includes(value.run.intent)) {
    return `${context.id} has no intent "${value.run.intent}"`;
  }
  if (owner !== context.owner && context.reserved.some((r) => chordsOverlap(r, value.chord))) {
    return `${chord} is reserved in ${context.id}`;
  }
  // GAP [[01M6YFRJGV8MAF2AM34N567MBQ]] the host approves a replacement by its owner's origin.
  if (value.replaces !== undefined && !approved(owner)) {
    return `it replaces ${value.replaces}, which waits for replacement approval: ${owner} may bind free chords, and taking a held one needs a person to approve it`;
  }
  const overlapping = held.filter((other) => chordsOverlap(other.value.chord, value.chord));
  if (value.replaces !== undefined && !overlapping.some(({ id }) => id === value.replaces)) {
    return `it replaces ${value.replaces}, which holds no chord overlapping ${chord} in ${context.id}`;
  }
  const chain = chainOf(value.replaces, held);
  // The newest binding it overlaps outside its chain: the one a key would reach.
  const taken = overlapping.findLast(({ id }) => !chain.has(id));
  if (taken !== undefined) {
    return `${chord} in ${context.id} is held by ${taken.id}; a binding that takes it says replaces: "${taken.id}"`;
  }
  return null;
}

/**
 * The keymap of `context` over the contributions to {@link KeybindingPoint}:
 * those naming it, the owner's first, each admitted unless its chord
 * overlaps one held or reserved outside the chain of the binding it
 * replaces. A key resolves to the newest admitted binding it matches: the
 * bindings one key matches are one chain ({@link refusal}), so that is the
 * replacement furthest down it, and a replacement takes exactly the chord
 * it names while each binding it stands on keeps the rest. A replacement
 * whose holder leaves is refused until it names the binding that holds the
 * chord then, so a key never moves to a binding no one chose for it.
 * The kernel admitted each binding by its id alone, so a refused one stays
 * contributed and inert: GAP [[01M6Y9H5FD9GVMK9N9QBT5DNTN]].
 */
export function admitKeybindings(
  context: KeyContext,
  contributions: readonly Contribution<Keybinding>[],
  approved: (owner: string) => boolean,
): Keymap {
  const named = contributions.filter(({ value }) => value.context === context.id);
  const ordered = [
    ...named.filter(({ owner }) => owner === context.owner),
    ...named.filter(({ owner }) => owner !== context.owner),
  ];
  const held: Contribution<Keybinding>[] = [];
  const refused: RefusedBinding[] = [];
  for (const binding of ordered) {
    const reason = refusal(context, held, binding, approved);
    if (reason === null) held.push(binding);
    else refused.push({ id: binding.id, reason });
  }
  return {
    refused,
    resolve: (ev) => held.findLast(({ value }) => matchesChord(ev, value.chord)),
  };
}

/**
 * The keymap of every context in `contexts` over `bindings`, by context id
 * ({@link admitKeybindings}).
 */
export function admitKeymaps(
  contexts: readonly KeyContext[],
  bindings: readonly Contribution<Keybinding>[],
  approved: (owner: string) => boolean,
): ReadonlyMap<string, Keymap> {
  return new Map(
    contexts.map((context) => [context.id, admitKeybindings(context, bindings, approved)]),
  );
}

/** The keymap of a context no plugin has contributed: it holds no key. */
const NO_KEYS: Keymap = { refused: [], resolve: () => undefined };

const readContexts = pointReader(KeyContextPoint);
const readBindings = pointReader(KeybindingPoint);
const keymaps = new WeakMap<
  readonly Contribution<KeyContextSpec>[],
  WeakMap<readonly Contribution<Keybinding>[], ReadonlyMap<string, Keymap>>
>();
const told = new Set<string>();

/**
 * Every context's keymap now, over the page kernel's contexts and
 * bindings: computed once per change to the kernel, and each refusal told
 * once a page session, naming the binding and why.
 */
function currentKeymaps(): ReadonlyMap<string, Keymap> {
  const contexts = readContexts();
  const bindings = readBindings();
  const byBindings = keymaps.get(contexts) ?? new WeakMap();
  keymaps.set(contexts, byBindings);
  const cached = byBindings.get(bindings);
  if (cached !== undefined) return cached;
  const admitted = admitKeymaps(contexts.map(keyContextOf), bindings, (owner) =>
    browserHost().replacementApproved(owner),
  );
  byBindings.set(bindings, admitted);
  for (const { refused } of admitted.values()) {
    for (const { id, reason } of refused) {
      const line = `Keybinding ${id} refused: ${reason}`;
      if (told.has(line)) continue;
      told.add(line);
      toast(line);
    }
  }
  return admitted;
}

/** The keymap of the context `id` now ({@link currentKeymaps}); one holding no key while no plugin contributes it. */
export function currentKeymap(id: string): Keymap {
  return currentKeymaps().get(id) ?? NO_KEYS;
}

/**
 * Read every context's keymap, which tells any refusal: the page does so
 * whenever its kernel moves, so a binding a keymap refuses is told when it
 * arrives, not at the first key pressed in its context.
 */
export function tellKeymaps(): void {
  currentKeymaps();
}
