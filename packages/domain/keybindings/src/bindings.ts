import { namespaced, type Contribution, type ContributionEntry } from "@kb/plugin";
import {
  byPlace,
  chordIncludes,
  chordsOverlap,
  describeChord,
  matchesChord,
  parseChord,
  type Chord,
  type KeyChordEvent,
} from "./chord.ts";

/** An action call as data, shared by keyboard and picker contributions. */
export interface ActionCall {
  readonly action: string;
  readonly input?: Readonly<Record<string, unknown>>;
}

/**
 * What a key runs: an intent of its context, by name; an action, through
 * the invoke path; or a command, by id, as a palette runs it.
 */
export type KeyRun = { readonly intent: string } | ActionCall | { readonly command: string };

/** A key in a context, and what it runs. */
export interface Keybinding {
  /** The context it is a key of, by id (`KeyContext.id`). */
  readonly context: string;
  readonly chord: Chord;
  readonly run: KeyRun;
  /** The ordinary shortcut description supplied by its declaration, if any. */
  readonly shortcut?: string;
  /** The binding whose chord this one takes, by its namespaced id. */
  readonly replaces?: string;
}

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
    readonly context: string;
    readonly chord: string;
    readonly run: KeyRun;
    readonly replaces?: string;
  },
): ContributionEntry<Keybinding> {
  const chord = parseChord(binding.chord);
  if (chord === null) throw new Error(`keybinding ${id}: "${binding.chord}" is not a chord`);
  return { id, value: { ...binding, chord } };
}

/**
 * A context as its owner contributes it: where it is offered keys, what its
 * bindings may run, and what no other plugin may take.
 */
export interface KeyContextSpec {
  /**
   * `page`: offered every key before any surface is, so a chord it holds is
   * held in every context, and it may not take a chord a surface's owner
   * binds there. `surface`: offered the keys of what has focus.
   */
  readonly reach: "page" | "surface";
  /** The intents a binding may run, by name. */
  readonly intents: readonly string[];
  /** Chords only the owner may bind. */
  readonly reserved: readonly Chord[];
}

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

/** A context's keymap: the binding a key event resolves to, what it holds, and what was refused. */
export interface Keymap {
  readonly resolve: (ev: KeyChordEvent) => Contribution<Keybinding> | undefined;
  readonly held: readonly Contribution<Keybinding>[];
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

/** Replacement wins before physical precedence; the remaining slots belong to one owner. */
function precedes(
  a: Contribution<Keybinding>,
  b: Contribution<Keybinding>,
  held: readonly Contribution<Keybinding>[],
): boolean {
  if (chainOf(a.value.replaces, held).has(b.id)) return true;
  if (chainOf(b.value.replaces, held).has(a.id)) return false;
  return byPlace(a.value.chord) && !byPlace(b.value.chord);
}

/**
 * Why `binding` may not join `held`, or null when it may. Every held
 * binding its chord competes with must be in its replacement chain, or a
 * fallback its holder already precedes throughout the replacement’s chord.
 */
function refusal(
  context: KeyContext,
  held: readonly Contribution<Keybinding>[],
  binding: Contribution<Keybinding>,
  approved: (owner: string, binding: Contribution<Keybinding>) => boolean,
  elsewhere: readonly Contribution<Keybinding>[],
): string | null {
  const { owner, value } = binding;
  const chord = describeChord(value.chord);
  const before = elsewhere.find((other) => chordsOverlap(other.value.chord, value.chord));
  if (before !== undefined) {
    return context.reach === "page"
      ? `${chord} is ${before.value.context}'s own, held by ${before.id}`
      : `${chord} is the page's, held by ${before.id}`;
  }
  if ("intent" in value.run && !context.intents.includes(value.run.intent)) {
    return `${context.id} has no intent "${value.run.intent}"`;
  }
  if (owner !== context.owner && context.reserved.some((r) => chordsOverlap(r, value.chord))) {
    return `${chord} is reserved in ${context.id}`;
  }
  // GAP [[01M6YFRJGV8MAF2AM34N567MBQ]] the host approves a replacement by its owner's origin.
  if (value.replaces !== undefined && !approved(owner, binding)) {
    return `it replaces ${value.replaces}, which waits for replacement approval: ${owner} may bind free chords, and taking a held one needs a person to approve it`;
  }
  const overlapping = held.filter((other) => chordsOverlap(other.value.chord, value.chord));
  if (value.replaces !== undefined && !overlapping.some(({ id }) => id === value.replaces)) {
    return `it replaces ${value.replaces}, which holds no chord overlapping ${chord} in ${context.id}`;
  }
  const chain = chainOf(value.replaces, held);
  // A replacement may inherit its holder's precedence over that owner's
  // fallback, but only where the holder covers the replacement's whole chord.
  const taken = overlapping.findLast((other) => {
    if (chain.has(other.id)) return false;
    if (other.owner === owner && byPlace(other.value.chord) !== byPlace(value.chord)) return false;
    return !held.some(
      (holder) =>
        chain.has(holder.id) &&
        holder.owner === other.owner &&
        precedes(holder, other, held) &&
        chordIncludes(holder.value.chord, value.chord),
    );
  });
  if (taken !== undefined) {
    return `${chord} in ${context.id} is held by ${taken.id}; a binding that takes it says replaces: "${taken.id}"`;
  }
  return null;
}

/**
 * The keymap of `context` over the contributions to {@link KeybindingPoint}:
 * those naming it, the owner's first, each admitted unless its chord
 * overlaps one held or reserved outside the chain of the binding it
 * replaces, or a fallback its holder precedes. A key resolves by the same
 * precedence ({@link precedes}): replacements before their holders, then
 * physical bindings before character fallbacks. A replacement takes exactly
 * the chord it names while each binding it stands on keeps the rest. A replacement
 * whose holder leaves is refused until it names the binding that holds the
 * chord then, so a key never moves to a binding no one chose for it.
 * `elsewhere` holds the chords another context holds first
 * ({@link admitKeymaps}): a binding overlapping one is refused.
 * The kernel admitted each binding by its id alone, so a refused one stays
 * contributed and inert: GAP [[01M6Y9H5FD9GVMK9N9QBT5DNTN]].
 */
export function admitKeybindings(
  context: KeyContext,
  contributions: readonly Contribution<Keybinding>[],
  approved: (owner: string, binding: Contribution<Keybinding>) => boolean,
  elsewhere: readonly Contribution<Keybinding>[] = [],
): Keymap {
  const named = contributions.filter(({ value }) => value.context === context.id);
  const ordered = [
    ...named.filter(({ owner }) => owner === context.owner),
    ...named.filter(({ owner }) => owner !== context.owner),
  ];
  const held: Contribution<Keybinding>[] = [];
  const refused: RefusedBinding[] = [];
  for (const binding of ordered) {
    const reason = refusal(context, held, binding, approved, elsewhere);
    if (reason === null) held.push(binding);
    else refused.push({ id: binding.id, reason });
  }
  return {
    refused,
    held,
    resolve: (ev) => {
      const matching = held.filter(({ value }) => matchesChord(ev, value.chord));
      return matching.findLast(
        (binding) => !matching.some((other) => precedes(other, binding, held)),
      );
    },
  };
}

/**
 * The keymap of every context in `contexts` over `bindings`, by context id
 * ({@link admitKeybindings}). The page's contexts are offered a key first,
 * so they are decided first, and neither kind may shadow the other: a page
 * binding may not take a chord a surface's owner binds in that surface
 * (the surface's own keys stand), and a surface binding may not take a
 * chord a page context holds (it would never be reached).
 */
export function admitKeymaps(
  contexts: readonly KeyContext[],
  bindings: readonly Contribution<Keybinding>[],
  approved: (owner: string, binding: Contribution<Keybinding>) => boolean,
): ReadonlyMap<string, Keymap> {
  const surfaces = contexts.filter(({ reach }) => reach === "surface");
  const pagesOwn = bindings.filter(({ owner, value }) =>
    contexts.some(
      (context) =>
        context.reach === "page" &&
        context.id === value.context &&
        context.owner === owner &&
        context.reserved.some((chord) => chordsOverlap(chord, value.chord)),
    ),
  );
  const surfacesOwn = bindings.filter(
    ({ owner, value }) =>
      surfaces.some((surface) => surface.id === value.context && surface.owner === owner) &&
      !pagesOwn.some((page) => chordsOverlap(page.value.chord, value.chord)),
  );
  const keymaps = new Map<string, Keymap>();
  for (const context of contexts.filter(({ reach }) => reach === "page")) {
    keymaps.set(context.id, admitKeybindings(context, bindings, approved, surfacesOwn));
  }
  const pages = [...keymaps.values()].flatMap(({ held }) => held);
  for (const context of surfaces) {
    keymaps.set(context.id, admitKeybindings(context, bindings, approved, pages));
  }
  return keymaps;
}

/** A family's keyboard definitions, shared by its graph description and page contributions. */
export interface KeyboardDefinition {
  readonly contexts?: readonly ContributionEntry<KeyContextSpec>[];
  readonly bindings?: readonly ContributionEntry<Keybinding>[];
}

/** The kernel's own address fold, shared by declaration publication and graph descriptions. */
export function keyboardIn(
  namespace: string,
  definition: KeyboardDefinition,
): Required<KeyboardDefinition> {
  const address = <T>(entry: ContributionEntry<T>): ContributionEntry<T> => ({
    ...entry,
    id: namespaced(namespace, entry.id),
    ...(entry.aliases === undefined
      ? {}
      : { aliases: entry.aliases.map((id) => namespaced(namespace, id)) }),
  });
  return {
    contexts: (definition.contexts ?? []).map(address),
    bindings: (definition.bindings ?? []).map(address),
  };
}
