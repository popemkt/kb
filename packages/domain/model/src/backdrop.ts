/**
 * Which backdrop a page head paints, how strong, which way it faces and
 * what art it draws (DESIGN-UI.md → Page-head backdrops): settings of core's node
 * (`sys.extension.core`), since the slot is core's and names no backdrop,
 * and the same fields on a node, for that node's page. The first three are
 * each a ref to one of its field's children: the backdrops are the options
 * the seed fold derives from the families' declarations, as it derives
 * views'. The art is a path of kb's own assets (`assets/…`): an image, or
 * a manifest naming several parts of the art (`backdrop-art.ts`). The
 * variants are refs to any of their field's children, the declared
 * backdrops' variants: the ones a head may show, one picked per load.
 */
import {
  declaredChoice,
  declaredIdOf,
  declaredOptionId,
  type DeclaredOptions,
  type SeedOption,
} from "./declared-option.ts";
import { isAssetPath } from "./asset.ts";
import { isBackdropArt } from "./backdrop-art.ts";
import { SYSTEM_IDS, type KbNode, type NodeId } from "./model.ts";
import { firstRef, firstStr } from "./node-config.ts";

/** The colour schemes a page is painted in. */
export type ColorScheme = "dark" | "light";

/**
 * One of a backdrop's variants (DESIGN-UI.md → Page-head backdrops →
 * Variants): a composition of the same backdrop, named by an id local to
 * it, and the schemes it is made for (both, unless it says).
 */
export interface BackdropVariant {
  readonly id: string;
  readonly label: string;
  readonly schemes?: readonly ColorScheme[];
}

/**
 * A backdrop as a declaration names it: a declared option, whose id its
 * contribution answers to in the page's backdrop point, and its variants,
 * if it has any.
 */
export interface SeedBackdrop extends SeedOption {
  readonly variants?: readonly BackdropVariant[];
}

/** The backdrops' options: the children of `sys.f.backdrop`. */
export const BACKDROP_OPTIONS: DeclaredOptions = {
  field: SYSTEM_IDS.backdropField,
  prefix: "sys.backdrop.",
};

/** The option node that names the backdrop `id` under `sys.f.backdrop`. */
export function backdropOptionId(id: string): NodeId {
  return declaredOptionId(BACKDROP_OPTIONS, id);
}

/**
 * The backdrops' variants: the children of `sys.f.backdrop.variant`, one
 * per variant of each declared backdrop (`backdropVariantOptions`).
 */
export const BACKDROP_VARIANT_OPTIONS: DeclaredOptions = {
  field: SYSTEM_IDS.backdropVariantField,
  prefix: "sys.backdrop-variant.",
};

/** A variant's declared id: its backdrop's, then its own. */
const variantId = (backdrop: SeedBackdrop, variant: BackdropVariant): string =>
  `${backdrop.id}.${variant.id}`;

/**
 * The variants of `backdrops` as declared options of their kind, each
 * choosing the backdrop it is a variant of: what a family declares, so the
 * seed derives one option per variant, and a value names it as it names any
 * option.
 */
export function backdropVariantOptions(backdrops: readonly SeedBackdrop[]): SeedOption[] {
  return backdrops.flatMap((backdrop) =>
    (backdrop.variants ?? []).map((variant) => ({
      id: variantId(backdrop, variant),
      label: `${backdrop.label} · ${variant.label}`,
      chooses: [{ kind: BACKDROP_OPTIONS, id: backdrop.id }],
    })),
  );
}

/**
 * The variants of `backdrop` a head may show on a `scheme` page, by local
 * id, given the variants its settings pin (`BackdropChoice.variants`):
 * those pinned, or all where none of this backdrop's is; of them, the ones
 * made for the scheme. Where none of them is, the pinned ones still, each
 * drawn in its look for the other scheme: a pin is the owner's word, so it
 * is kept over the scheme. Empty for a backdrop with no variants.
 */
export function shownVariants(
  backdrop: SeedBackdrop,
  pinned: readonly string[],
  scheme: ColorScheme,
): string[] {
  const all = backdrop.variants ?? [];
  const chosen = all.filter((variant) => pinned.includes(variantId(backdrop, variant)));
  const set = chosen.length === 0 ? all : chosen;
  const suited = set.filter((variant) => (variant.schemes ?? [scheme]).includes(scheme));
  return (suited.length === 0 ? set : suited).map((variant) => variant.id);
}

export const BACKDROP_STRENGTHS = ["subtle", "soft", "vivid"] as const;
export type BackdropStrength = (typeof BACKDROP_STRENGTHS)[number];
export const BACKDROP_DIRECTIONS = ["down", "up"] as const;
export type BackdropDirection = (typeof BACKDROP_DIRECTIONS)[number];

/**
 * The option nodes `sys.f.backdrop.strength` and `sys.f.backdrop.direction`
 * refer to: those fields' children (DESIGN.md → Kinds, roles and options).
 */
export const BACKDROP_STRENGTH_OPTION_IDS: Readonly<Record<BackdropStrength, NodeId>> = {
  subtle: "sys.backdrop-strength.subtle",
  soft: "sys.backdrop-strength.soft",
  vivid: "sys.backdrop-strength.vivid",
};
export const BACKDROP_DIRECTION_OPTION_IDS: Readonly<Record<BackdropDirection, NodeId>> = {
  down: "sys.backdrop-direction.down",
  up: "sys.backdrop-direction.up",
};

/** A page head's backdrop, as its settings say. */
export interface BackdropChoice {
  /** A contributed backdrop's id; null, the first contributed. */
  readonly backdrop: string | null;
  readonly strength: BackdropStrength;
  readonly direction: BackdropDirection;
  /**
   * A file of kb's own assets (`assets/…`) naming the art the backdrop draws
   * in place of its own, where it has art to replace (the Wolf medallion's
   * relief and glyphs): an image, or an art manifest (`backdropArtOf`);
   * null, its own.
   */
  readonly art: string | null;
  /**
   * The variants pinned (declared ids, of any backdrop): every one the
   * nearest node that pins any holds; none, all of them (`shownVariants`).
   */
  readonly variants: readonly string[];
}

type Props = KbNode["props"];

function optionOf<V extends string>(
  values: readonly V[],
  ids: Readonly<Record<V, NodeId>>,
  ref: NodeId | undefined,
): V | undefined {
  return values.find((value) => ids[value] === ref);
}

/**
 * The backdrop `sources` choose, nearest first (the page's own node, then
 * core's), among the backdrops contributed (`contributed`, by id): each
 * setting is the first one that holds a value it reads as one of its
 * options, and the first contributed backdrop, `subtle` and `down` where
 * none does. A backdrop nobody contributes now (its plugin unloaded, its
 * declaration gone) is no option, so it falls through as an unknown
 * strength does; so does art that names no image or art manifest of kb's
 * assets.
 */
export function backdropChoice(
  sources: readonly (Props | undefined)[],
  contributed: readonly string[],
): BackdropChoice {
  const held = sources.filter((props): props is Props => props !== undefined);
  const first = <V>(read: (props: Props) => V | undefined): V | undefined =>
    held.map(read).find((value) => value !== undefined);
  return {
    backdrop: declaredChoice(BACKDROP_OPTIONS, held, contributed),
    strength:
      first((props) =>
        optionOf(
          BACKDROP_STRENGTHS,
          BACKDROP_STRENGTH_OPTION_IDS,
          firstRef(SYSTEM_IDS.backdropStrengthField)(props),
        ),
      ) ?? "subtle",
    direction:
      first((props) =>
        optionOf(
          BACKDROP_DIRECTIONS,
          BACKDROP_DIRECTION_OPTION_IDS,
          firstRef(SYSTEM_IDS.backdropDirectionField)(props),
        ),
      ) ?? "down",
    art:
      first((props) => {
        const path = firstStr(SYSTEM_IDS.backdropArtField)(props);
        return path !== undefined && isAssetPath(path) && isBackdropArt(path) ? path : undefined;
      }) ?? null,
    variants:
      first((props) => {
        const pinned = (props[SYSTEM_IDS.backdropVariantField] ?? []).flatMap((value) =>
          value.t === "ref" ? (declaredIdOf(BACKDROP_VARIANT_OPTIONS, value.v) ?? []) : [],
        );
        return pinned.length === 0 ? undefined : pinned;
      }) ?? [],
  };
}
