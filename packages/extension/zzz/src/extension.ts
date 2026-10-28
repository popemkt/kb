/**
 * The ZZZ family's declaration and its shared plugin (DESIGN.md → Extension
 * families; DESIGN-UI.md → Themes): one whole theme, after Zenless Zone
 * Zero (ART-DIRECTION.md → ZZZ). It declares the theme's design system and
 * the two page heads it brings, so the seed derives their options, and
 * contributes them in its browser half, `@kb/zzz-ui`; it declares no view,
 * so its shared plugin is its declaration's, empty on both hosts. It is
 * optional and on by default; switched off, a page painted in ZZZ falls to
 * the default and its heads leave, whatever else stays on.
 *
 * The theme was the themes family's until it became a family of its own,
 * under `themes.*` ids; the family retires those (`retires`), so a store
 * that chose `themes.zzz` chooses `zzz.theme` when it is opened.
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
 * After Zenless Zone Zero: stickers, comic panels, slanted wipes, jelly
 * springs and TV static, on a near-black street (ART-DIRECTION.md).
 */
export const ZZZ_DESIGN_SYSTEM = themeSystem("zzz.theme", "ZZZ", "zzz.broadcast", {
  intensity: "lively",
  style: "wobbly",
  speed: "snappy",
  effects: { press: true, hoverLift: true, listEnter: true, toggles: true },
});
/** ZZZ's page head: a broadcast on a stack of slanted panels, with its TV. */
export const BROADCAST_BACKDROP = themeBackdrop("zzz.broadcast", "Broadcast", ZZZ_DESIGN_SYSTEM.id);
/** ZZZ's other head: a Hollow, the rift's ether behind a torn comic panel. */
export const HOLLOW_BACKDROP = themeBackdrop("zzz.hollow", "Hollow", ZZZ_DESIGN_SYSTEM.id);

export const zzzExtension = defineExtension({
  name: "zzz",
  label: "ZZZ",
  tags: ["themes"],
  optional: { byDefault: "on" },
  declaredOptions: [
    { kind: DESIGN_SYSTEM_OPTIONS, options: [ZZZ_DESIGN_SYSTEM] },
    { kind: BACKDROP_OPTIONS, options: [BROADCAST_BACKDROP, HOLLOW_BACKDROP] },
  ],
  retires: [
    retiredOption(DESIGN_SYSTEM_OPTIONS, "themes.zzz", ZZZ_DESIGN_SYSTEM.id),
    retiredOption(BACKDROP_OPTIONS, "themes.broadcast", BROADCAST_BACKDROP.id),
    retiredOption(BACKDROP_OPTIONS, "themes.hollow", HOLLOW_BACKDROP.id),
  ],
});

/** The ZZZ family's shared plugin: its declaration's, on either host. */
export function zzzPlugin(): Plugin {
  return declarationPlugin(zzzExtension);
}
