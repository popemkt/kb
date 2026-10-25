/**
 * The themes family's declaration and its shared plugin (DESIGN.md →
 * Extension families). It contributes the design systems kb ships beside
 * core's default (DESIGN-UI.md → Design tokens → Design systems): Paper and
 * Terminal, page-wide skins owned by no view family, and two whole themes,
 * ZZZ and Transistor, each a system with its art and the page-head backdrop
 * it pairs with (Themes; ART-DIRECTION.md). It declares its
 * systems, so the seed derives each one's option under
 * `sys.f.design-system`, and contributes them in its browser half; it
 * declares no view, so its shared plugin is its declaration's, empty on
 * both hosts. It is optional and on by default; switched off, the page
 * offers core's default and whatever other family contributes a design
 * system, and a page painted in one of its systems falls to the default.
 */
import { declarationPlugin, defineExtension } from "@kb/contracts";
import {
  BACKDROP_OPTIONS,
  DESIGN_SYSTEM_OPTIONS,
  type SeedBackdrop,
  type SeedOption,
} from "@kb/model";
import type { Plugin } from "@kb/plugin";

/** Warm off-white and ink, an ink-blue accent and the platform serif. */
export const PAPER_DESIGN_SYSTEM: SeedOption = { id: "themes.paper", label: "Paper" };
/** Dark-first phosphor green, one monospace face throughout. */
export const TERMINAL_DESIGN_SYSTEM: SeedOption = { id: "themes.terminal", label: "Terminal" };
/**
 * After Zenless Zone Zero: stickers, comic panels, slanted wipes, jelly
 * springs and TV static, on a near-black street (ART-DIRECTION.md).
 */
export const ZZZ_DESIGN_SYSTEM: SeedOption = { id: "themes.zzz", label: "ZZZ" };
/**
 * After Transistor: Cloudbank at night in Art Nouveau, and Turn()'s frozen
 * cyan planning frame (ART-DIRECTION.md).
 */
export const TRANSISTOR_DESIGN_SYSTEM: SeedOption = {
  id: "themes.transistor",
  label: "Transistor",
};

/** ZZZ's page head: a broadcast on a stack of slanted panels, with its TV. */
export const BROADCAST_BACKDROP: SeedBackdrop = { id: "themes.broadcast", label: "Broadcast" };
/** Transistor's page head: Cloudbank's skyline under a painted dusk. */
export const CLOUDBANK_BACKDROP: SeedBackdrop = { id: "themes.cloudbank", label: "Cloudbank" };

export const themesExtension = defineExtension({
  name: "themes",
  label: "Themes",
  tags: ["themes"],
  optional: { byDefault: "on" },
  declaredOptions: [
    {
      kind: DESIGN_SYSTEM_OPTIONS,
      options: [
        PAPER_DESIGN_SYSTEM,
        TERMINAL_DESIGN_SYSTEM,
        ZZZ_DESIGN_SYSTEM,
        TRANSISTOR_DESIGN_SYSTEM,
      ],
    },
    { kind: BACKDROP_OPTIONS, options: [BROADCAST_BACKDROP, CLOUDBANK_BACKDROP] },
  ],
});

/** The themes family's shared plugin: its declaration's, on either host. */
export function themesPlugin(): Plugin {
  return declarationPlugin(themesExtension);
}
