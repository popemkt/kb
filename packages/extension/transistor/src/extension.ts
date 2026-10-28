/**
 * The Transistor family's declaration and its shared plugin (DESIGN.md →
 * Extension families; DESIGN-UI.md → Themes): one whole theme, after
 * Transistor (ART-DIRECTION.md → Transistor). It declares the theme's
 * design system and the two page heads it brings, so the seed derives their
 * options, and contributes them in its browser half, `@kb/transistor-ui`;
 * it declares no view, so its shared plugin is its declaration's, empty on
 * both hosts. It is optional and on by default; switched off, a page
 * painted in Transistor falls to the default and its heads leave, whatever
 * else stays on.
 *
 * The theme was the themes family's until it became a family of its own,
 * under `themes.*` ids; the family retires those (`retires`), so a store
 * that chose `themes.transistor` chooses `transistor.theme` when it is
 * opened.
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
 * After Transistor: Cloudbank at night in Art Nouveau, Turn()'s frozen
 * planning frame, functions written as calls (ART-DIRECTION.md).
 */
export const TRANSISTOR_DESIGN_SYSTEM = themeSystem(
  "transistor.theme",
  "Transistor",
  "transistor.cloudbank",
  {
    intensity: "lively",
    style: "clean",
    speed: "relaxed",
    effects: { listEnter: true, focusRing: true, workingGlow: true },
  },
);
/** Transistor's page head: Cloudbank's skyline under a painted dusk. */
export const CLOUDBANK_BACKDROP = themeBackdrop(
  "transistor.cloudbank",
  "Cloudbank",
  TRANSISTOR_DESIGN_SYSTEM.id,
);
/** Transistor's other head: an OVC voting terminal's amber screen. */
export const OVC_BACKDROP = themeBackdrop(
  "transistor.ovc",
  "OVC Terminal",
  TRANSISTOR_DESIGN_SYSTEM.id,
);

export const transistorExtension = defineExtension({
  name: "transistor",
  label: "Transistor",
  tags: ["themes"],
  optional: { byDefault: "on" },
  declaredOptions: [
    { kind: DESIGN_SYSTEM_OPTIONS, options: [TRANSISTOR_DESIGN_SYSTEM] },
    { kind: BACKDROP_OPTIONS, options: [CLOUDBANK_BACKDROP, OVC_BACKDROP] },
  ],
  retires: [
    retiredOption(DESIGN_SYSTEM_OPTIONS, "themes.transistor", TRANSISTOR_DESIGN_SYSTEM.id),
    retiredOption(BACKDROP_OPTIONS, "themes.cloudbank", CLOUDBANK_BACKDROP.id),
    retiredOption(BACKDROP_OPTIONS, "themes.ovc", OVC_BACKDROP.id),
  ],
});

/** The Transistor family's shared plugin: its declaration's, on either host. */
export function transistorPlugin(): Plugin {
  return declarationPlugin(transistorExtension);
}
