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
  motionPresetProps,
  type MotionPreset,
  type SeedBackdrop,
  type SeedOption,
} from "@kb/model";
import type { Plugin } from "@kb/plugin";

/** Warm off-white and ink, an ink-blue accent and the platform serif. */
export const PAPER_DESIGN_SYSTEM: SeedOption = { id: "themes.paper", label: "Paper" };
/** Dark-first phosphor green, one monospace face throughout. */
export const TERMINAL_DESIGN_SYSTEM: SeedOption = { id: "themes.terminal", label: "Terminal" };
/** A backdrop that belongs to the theme `system`: its option chooses the system. */
function themed(id: string, label: string, system: string): SeedBackdrop {
  return { id, label, chooses: [{ kind: DESIGN_SYSTEM_OPTIONS, id: system }] };
}

/**
 * A theme: a design system whose option chooses the backdrop it pairs with,
 * so a page head shows it while no page and no setting chooses another
 * (DESIGN-UI.md → Themes), and holds its motion preset, which the page
 * moves by while core's node sets no motion option (Motion options). Both
 * are data, as any choice is.
 */
function theme(id: string, label: string, pairsWith: string, motion: MotionPreset): SeedOption {
  return {
    id,
    label,
    chooses: [{ kind: BACKDROP_OPTIONS, id: pairsWith }],
    props: motionPresetProps(motion),
  };
}

/**
 * After Zenless Zone Zero: stickers, comic panels, slanted wipes, jelly
 * springs and TV static, on a near-black street (ART-DIRECTION.md).
 */
export const ZZZ_DESIGN_SYSTEM = theme("themes.zzz", "ZZZ", "themes.broadcast", {
  intensity: "lively",
  style: "wobbly",
  speed: "snappy",
  effects: { press: true, hoverLift: true, listEnter: true, toggles: true },
});
/**
 * After Transistor: Cloudbank at night in Art Nouveau, Turn()'s frozen
 * planning frame, functions written as calls (ART-DIRECTION.md).
 */
export const TRANSISTOR_DESIGN_SYSTEM = theme(
  "themes.transistor",
  "Transistor",
  "themes.cloudbank",
  {
    intensity: "lively",
    style: "clean",
    speed: "relaxed",
    effects: { listEnter: true, focusRing: true, workingGlow: true },
  },
);
/**
 * After NieR:Automata: YoRHa's warm beige paper, khaki ink, square corners,
 * mechanical motion and a glitch on failure (ART-DIRECTION.md).
 */
export const YORHA_DESIGN_SYSTEM = theme("themes.yorha", "YoRHa", "themes.bunker", {
  intensity: "subtle",
  style: "clean",
  speed: "snappy",
  effects: { press: true, listEnter: true, focusRing: true },
});

/** ZZZ's page head: a broadcast on a stack of slanted panels, with its TV. */
export const BROADCAST_BACKDROP = themed("themes.broadcast", "Broadcast", ZZZ_DESIGN_SYSTEM.id);
/** ZZZ's other head: a Hollow, the rift's ether behind a torn comic panel. */
export const HOLLOW_BACKDROP = themed("themes.hollow", "Hollow", ZZZ_DESIGN_SYSTEM.id);
/** Transistor's page head: Cloudbank's skyline under a painted dusk. */
export const CLOUDBANK_BACKDROP = themed(
  "themes.cloudbank",
  "Cloudbank",
  TRANSISTOR_DESIGN_SYSTEM.id,
);
/** Transistor's other head: an OVC voting terminal's amber screen. */
export const OVC_BACKDROP = themed("themes.ovc", "OVC Terminal", TRANSISTOR_DESIGN_SYSTEM.id);
/** YoRHa's page head: the Bunker's HUD, bracketed, over a score's staff. */
export const BUNKER_BACKDROP = themed("themes.bunker", "Bunker", YORHA_DESIGN_SYSTEM.id);

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
        YORHA_DESIGN_SYSTEM,
      ],
    },
    {
      kind: BACKDROP_OPTIONS,
      options: [
        BROADCAST_BACKDROP,
        HOLLOW_BACKDROP,
        CLOUDBANK_BACKDROP,
        OVC_BACKDROP,
        BUNKER_BACKDROP,
      ],
    },
  ],
});

/** The themes family's shared plugin: its declaration's, on either host. */
export function themesPlugin(): Plugin {
  return declarationPlugin(themesExtension);
}
