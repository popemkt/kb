/**
 * The YoRHa family's declaration and its shared plugin (DESIGN.md →
 * Extension families; DESIGN-UI.md → Themes): one whole theme, after
 * NieR:Automata (ART-DIRECTION.md → YoRHa). It declares the theme's design
 * system and the two page heads it brings, so the seed derives their
 * options, and contributes them in its browser half, `@kb/yorha-ui`; it
 * declares no view, so its shared plugin is its declaration's, empty on
 * both hosts. It is optional and on by default; switched off, a page
 * painted in YoRHa falls to the default and its heads leave, whatever else
 * stays on.
 *
 * The theme was the themes family's until it became a family of its own,
 * under `themes.*` ids; the family retires those (`retires`), so a store
 * that chose `themes.yorha` chooses `yorha.theme` when it is opened.
 */
import { declarationPlugin, defineExtension } from "@kb/contracts";
import {
  BACKDROP_OPTIONS,
  DESIGN_SYSTEM_OPTIONS,
  retiredOption,
  themeBackdrop,
  themeSystem,
} from "@kb/model";
import type { Plugin } from "@kb/plugin";

/**
 * After NieR:Automata: YoRHa's warm beige paper, khaki ink, square corners,
 * mechanical motion and a glitch on failure (ART-DIRECTION.md).
 */
export const YORHA_DESIGN_SYSTEM = themeSystem("yorha.theme", "YoRHa", "yorha.bunker", {
  intensity: "subtle",
  style: "clean",
  speed: "snappy",
  effects: { press: true, listEnter: true, focusRing: true },
});
/** YoRHa's page head: the Bunker's HUD, bracketed, over a score's staff. */
export const BUNKER_BACKDROP = themeBackdrop("yorha.bunker", "Bunker", YORHA_DESIGN_SYSTEM.id);
/** YoRHa's other head: a hacking arena in 3D, its camera turning between views. */
export const ARENA_BACKDROP = themeBackdrop("yorha.arena", "Arena", YORHA_DESIGN_SYSTEM.id);

export const yorhaExtension = defineExtension({
  name: "yorha",
  label: "YoRHa",
  tags: ["themes"],
  optional: { byDefault: "on" },
  declaredOptions: [
    { kind: DESIGN_SYSTEM_OPTIONS, options: [YORHA_DESIGN_SYSTEM] },
    { kind: BACKDROP_OPTIONS, options: [BUNKER_BACKDROP, ARENA_BACKDROP] },
  ],
  retires: [
    retiredOption(DESIGN_SYSTEM_OPTIONS, "themes.yorha", YORHA_DESIGN_SYSTEM.id),
    retiredOption(BACKDROP_OPTIONS, "themes.bunker", BUNKER_BACKDROP.id),
    retiredOption(BACKDROP_OPTIONS, "themes.arena", ARENA_BACKDROP.id),
  ],
});

/** The YoRHa family's shared plugin: its declaration's, on either host. */
export function yorhaPlugin(): Plugin {
  return declarationPlugin(yorhaExtension);
}
