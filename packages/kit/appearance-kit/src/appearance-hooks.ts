import { useMemo } from "react";
import { assetUrl, extensionNodeId, type KnobValues } from "@kb/model";
import {
  backdropChoice,
  backdropKnobValues,
  backdropOptionId,
  backdropVariantOptionId,
  designSystemOptionId,
  type BackdropDirection,
  type BackdropStrength,
  type SeedBackdrop,
} from "@kb/appearance";
import type { Contribution } from "@kb/plugin";
import {
  useNode,
  type OutlineNode,
  chosenDeclared,
  uiKernelReader,
  useContributions,
} from "@kb/ui-sdk";

import { shownDesignSystem } from "./lib/design-system.ts";
import {
  BackdropPoint,
  DesignSystemPoint,
  type Backdrop,
  type DesignSystem,
} from "./lib/appearance-points.ts";

import { readBackdrops, type ContributedBackdrops } from "./lib/backdrop-decode.ts";

/**
 * A page head's backdrop: the contribution it shows (null, none
 * contributed), the strength chosen (null, none: its variant's, else the
 * default, `shownStrength`), its direction, the URL of the art it draws
 * in place of its own (null, its own), and the variants pinned, by
 * declared id (none, all: `shownVariants`).
 */
export interface PageBackdropChoice {
  readonly backdrop: Contribution<Backdrop> | null;
  readonly strength: BackdropStrength | null;
  readonly direction: BackdropDirection;
  readonly art: string | null;
  readonly variants: readonly string[];
}

/**
 * The design system painting the page (DESIGN-UI.md → Design tokens →
 * Design systems): the contributed one core's setting chooses, else the
 * first contributed, core's default. Null only before core's plugins load.
 */
export function useShownDesignSystem(): DesignSystem | null {
  const systems = useContributions(DesignSystemPoint);
  const core = useNode(extensionNodeId("core"));
  return shownDesignSystem(systems, core?.props)?.value ?? null;
}

/**
 * `BackdropPoint` as the kernel held it at its version, read once, whoever
 * reads it: each reader of a point holds its own array of it, so the read is
 * kept by the kernel's version, not by the array. A head and the pane's host
 * that draws it then hold the same backdrop, not two copies of one.
 */
const backdropsRead = new Map<number, ContributedBackdrops>();

/**
 * The backdrops the page can draw, and those it refused (DESIGN-UI.md →
 * Page-head backdrops → Read once, checked): `BackdropPoint` as every
 * reader of it reads it (`readBackdrops`), so no head, card or studio
 * draws a contribution the page has not checked.
 */
export function useBackdrops(): ContributedBackdrops {
  const contributed = useContributions(BackdropPoint);
  const version = uiKernelReader.version();
  const known = backdropsRead.get(version);
  if (known !== undefined) return known;
  const read = readBackdrops(contributed);
  backdropsRead.clear();
  backdropsRead.set(version, read);
  return read;
}

/**
 * The backdrop `node`'s page head shows (DESIGN-UI.md → Page-head
 * backdrops): each setting from the node's own settings, then core's node's,
 * then the shown design system's option node, whose choices are the theme's
 * pairing (DESIGN-UI.md → Themes); with no node, from core's on. Where none
 * chooses a backdrop, the first contributed.
 * A page's own settings are `sys.*` fields, which field rows hide, so no
 * gesture writes them yet. GAP [[01M54CEM0Z5SMAS7KABS7QZ67C]]
 */
export function usePageBackdrop(node?: OutlineNode): PageBackdropChoice {
  const contributions = useBackdrops().shown;
  const core = useNode(extensionNodeId("core"));
  const system = useShownDesignSystem();
  const theme = useNode(system === null ? undefined : designSystemOptionId(system.key.id));
  const own = node?.props;
  const coreProps = core?.props;
  const themeProps = theme?.props;
  // One object while nothing it reads changes, so a head declares it to its host only when it changes.
  return useMemo(() => {
    const choice = backdropChoice(
      [own, coreProps, themeProps],
      contributions.map(({ value }) => value.key.id),
    );
    return {
      backdrop: chosenDeclared(contributions, choice.backdrop),
      strength: choice.strength,
      direction: choice.direction,
      art: choice.art === null ? null : assetUrl(choice.art),
      variants: choice.variants,
    };
  }, [contributions, own, coreProps, themeProps]);
}

/**
 * The values of the knobs `backdrop` shows with `variant` drawn (null,
 * none), as its option node and its variant's hold them (DESIGN-UI.md →
 * Page-head contributions → Knobs): read live, so a value written anywhere (the
 * studio, `kb set`, an agent) reaches every frame that shows it.
 */
export function useBackdropKnobs(backdrop: SeedBackdrop, variant: string | null): KnobValues {
  const own = useNode(backdropOptionId(backdrop.id));
  const variants = useNode(
    variant === null ? undefined : backdropVariantOptionId(backdrop.id, variant),
  );
  const ownProps = own?.props;
  const variantProps = variants?.props;
  // One object while nothing it reads changes, so a frame hears a change only when there is one.
  return useMemo(
    () => backdropKnobValues(backdrop, variant, ownProps, variantProps),
    [backdrop, variant, ownProps, variantProps],
  );
}
