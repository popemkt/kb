/** Appearance contribution contracts, independent of the page kernel implementation. */
import type { ComponentType } from "react";
import type { Icon } from "@phosphor-icons/react";
import { CORE_POINT_DEFINITIONS } from "@kb/contracts";
import { Point, type ContributionEntry } from "@kb/plugin";
import type { SeedOption, KnobValues } from "@kb/model";
import type { BackdropDirection, BackdropStrength, SeedBackdrop } from "@kb/appearance";
import {
  type OutlineNode,
  type PointerSource,
  provideDeclared,
  type PageActivity,
  type BackdropBudget,
} from "@kb/ui-sdk";

/**
 * How far across the page a backdrop's frame reaches: centred under the
 * head's content and at most `maxWidth` wide, or across the whole scroll
 * region behind it (`BREAKOUT_CLASS`), whatever the content's width, so a
 * wider window or the full content width adds field at its sides.
 */
type BackdropSpan =
  | { readonly reach: "content"; readonly maxWidth: number }
  | { readonly reach: "region" };

/**
 * How a page head frames a backdrop: the breathing room it reserves above
 * the head's content, its frame's height, span and vertical offset, the
 * directions it can face (none, when it has no direction), and how opaque
 * it is at each strength.
 */
export interface BackdropPresentation {
  readonly space: number;
  readonly height: number;
  readonly span: BackdropSpan;
  readonly offset: number;
  readonly directions: readonly BackdropDirection[];
  readonly opacity: Readonly<Record<BackdropStrength, number>>;
}

/** What a page head tells the backdrop it shows. */
export interface BackdropProps {
  /** The head's colour: the shown node's tag colour, else the accent. */
  readonly color: string;
  /** The node the head shows, when it shows one. */
  readonly node: OutlineNode | undefined;
  readonly strength: BackdropStrength;
  readonly direction: BackdropDirection;
  /**
   * The URL of the file of kb's assets naming the art the backdrop draws in
   * place of its own, where it has art to replace: an image, or an art
   * manifest of several parts (`@kb/model`'s `BackdropArt`); null, its own.
   * A backdrop with no art to replace ignores it.
   */
  readonly art: string | null;
  /**
   * The variant it shows, by the local id its key declares
   * (`SeedBackdrop.variants`): of those its settings pin, or all, that suit
   * the page's scheme (`shownVariants`), the one the load's seed draws
   * (`drawVariant`); null for a backdrop with no variants.
   */
  readonly variant: string | null;
  /** The presentation's opacity at `strength`. */
  readonly opacity: number;
  /**
   * Its knobs' values, by id (`knobsOf`: its own and its variant's): each
   * knob's default where nothing sets it.
   */
  readonly knobs: KnobValues;
  /** What it may spend a frame (`Backdrop.budget`). */
  readonly budget: BackdropBudget;
  /** What the owner is doing on the page now. */
  readonly activity: PageActivity;
  /**
   * The pointer over the backdrop's own frame, polled (`pointer.now()`): the
   * slot owns the one listener, so a backdrop adds none.
   */
  readonly pointer: PointerSource;
}

/**
 * What a backdrop can be seen to answer (DESIGN-UI.md → Page-head
 * backdrops → Its interactions): the pointer over its frame (`pointer`), a
 * move to another page (`navigation`, the `node` it is handed changing), or
 * one of the things its activity says the owner does (`PageActivity`:
 * `editing`, typing in a node; `writes`; and the page's `arrivals`,
 * `errors` and `turns`). The activity's own fields name them, so a cue
 * the activity gains is one a backdrop can declare.
 */
export type BackdropCue = "pointer" | "navigation" | keyof PageActivity;

/**
 * Each cue as a person reads it, in the order it is listed: the cue
 * vocabulary's one table, so a cue the type gains has a name before any
 * backdrop can declare it.
 */
export const BACKDROP_CUE_LABELS: Readonly<Record<BackdropCue, string>> = {
  pointer: "Pointer",
  editing: "Typing",
  writes: "A write",
  navigation: "Another page",
  arrivals: "A change from elsewhere",
  errors: "An error",
  turns: "An agent's turn",
};

/** One thing a backdrop does when its cue moves, said in a line ("ripples follow the cursor"). */
export interface BackdropInteraction {
  readonly cue: BackdropCue;
  readonly does: string;
}

/**
 * A page-head backdrop: the ambience painted behind a page's head
 * (DESIGN-UI.md → Page-head backdrops). Every page head renders the chosen
 * one through one slot (`PageBackdrop`) and names none. Its `key` is the
 * backdrop its family declares, whose option node choosing it refers to:
 * its label, credit, variants, default strength and knobs. Its
 * contribution adds how a head frames it, what it may spend a frame, what
 * it answers, and its scene, the component the slot instantiates wherever it is drawn (a
 * head, a card, the studio).
 */
export interface Backdrop {
  readonly key: SeedBackdrop;
  readonly presentation: BackdropPresentation;
  readonly budget: BackdropBudget;
  /**
   * What it answers, each a line on what it does when its cue moves, as
   * Backdrop Studio lists them and lets a person try them; none, for a
   * backdrop that answers nothing.
   */
  readonly interactions: readonly BackdropInteraction[];
  readonly Component: ComponentType<BackdropProps>;
}

export const BackdropPoint = Point<Backdrop>()(
  CORE_POINT_DEFINITIONS.backdrop.name,
  CORE_POINT_DEFINITIONS.backdrop.spec,
);

/**
 * Something a page head's backdrop offers where its owner double-clicks it
 * (DESIGN-UI.md → Page-head backdrops → Its actions): the slot owns the
 * gesture and the corner it shows them in, and names none; a family
 * contributes what it offers, as Backdrop Studio offers "Open in Studio".
 */
export interface BackdropAction {
  readonly label: string;
  readonly icon: Icon;
  /** Do it for the backdrop the head shows, by its declared id (`SeedBackdrop.id`). */
  readonly run: (backdrop: string) => void;
}

export const BackdropActionPoint = Point<BackdropAction>()(
  CORE_POINT_DEFINITIONS.backdropAction.name,
  CORE_POINT_DEFINITIONS.backdropAction.spec,
);

/**
 * The backdrop its family declares as `key`, as its page plugin contributes
 * it: under the key's local id, so in the family's namespace it answers to
 * the declared id, as a view answers to its key (`provideView`).
 */
export function provideBackdrop(
  key: SeedBackdrop,
  backdrop: Omit<Backdrop, "key">,
): ContributionEntry<Backdrop> {
  return provideDeclared({ key, ...backdrop });
}

/**
 * A design system as the page holds it (DESIGN-UI.md → Design tokens →
 * Design systems): one complete set of layer-1 values, light and dark. Its
 * `key` is the system as its family names it, and the id `<html
 * data-theme>` carries while it paints the page. Its `stylesheet` is what
 * the page adds to paint it: its base and dark blocks over layer 1 under
 * `[data-theme="<id>"]`, empty for core's default, which is layer 1 itself.
 * The page adds every contributed sheet and names none, so a family's
 * system paints while its plugin is loaded and is gone when it unloads.
 */
export interface DesignSystem {
  readonly key: SeedOption;
  readonly stylesheet: string;
  /**
   * The system's art: illustration and ambient motion painted once for the
   * whole workspace while the system paints the page, in two planes (the
   * shell's one slot, `ThemeArt`, mounted once per plane). None for a
   * system that is tokens alone.
   */
  readonly Art?: ComponentType<ThemeArtProps>;
}

/**
 * The three planes of a design system's art (`ThemeArtProps.plane`): the
 * `ground` under everything, the `veil` over the whole window (a write's
 * gesture), and a `pane` over each pane (that pane's page change).
 */
export type ThemeArtPlane = "ground" | "veil" | "pane";

/**
 * What the shell tells a design system's art layer: what the owner is doing
 * (the same signal a backdrop reads) and, for a pane's plane, that pane's
 * own page, so a page change is answered by a gesture (a wipe, a Jaunt())
 * in the pane that changed and nowhere else. The layer is
 * `pointer-events: none` and hidden from assistive technology; it hears no
 * input of its own.
 */
export interface ThemeArtProps {
  /**
   * Which plane is drawn: `ground`, under everything the shell draws, where
   * the art lives; or `veil`, over everything, for a passing gesture only (a
   * wipe, a frozen frame) — a veil at rest draws nothing, so it never sits
   * between the owner and their text.
   */
  readonly plane: ThemeArtPlane;
  readonly activity: PageActivity;
  /**
   * In the `pane` plane, the path of the pane it lies over: it changes only
   * when that pane's own page does, never when the focus moves to another
   * pane. In the other planes, the focused pane's path.
   */
  readonly path: string;
}

/**
 * The longest a veil may hold a passing gesture, in ms, whatever becomes of
 * its animation (a hidden tab, one cancelled or interrupted): a gesture past
 * it is gone from the page. However fast the pages change, the veil draws
 * what one change draws, and nothing once this has passed.
 */
export const THEME_GESTURE_MAX_MS = 2400;

export const DesignSystemPoint = Point<DesignSystem>()(
  CORE_POINT_DEFINITIONS.designSystem.name,
  CORE_POINT_DEFINITIONS.designSystem.spec,
);

/** The design system its family names `key`, as its page plugin contributes it (`provideBackdrop`). */
export function provideDesignSystem(
  key: SeedOption,
  system: Omit<DesignSystem, "key">,
): ContributionEntry<DesignSystem> {
  return provideDeclared({ key, ...system });
}
