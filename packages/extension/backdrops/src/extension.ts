/**
 * The backdrops family's declaration and its shared plugin (DESIGN.md →
 * Extension families). It contributes the page-head backdrops kb ships
 * (DESIGN-UI.md → Page-head backdrops): ambience every page head can show,
 * owned by no view family, so neither by the outline. It declares its
 * backdrops, so the seed derives each one's option under `sys.f.backdrop`,
 * and contributes them in its browser half; it declares no view, so its
 * shared plugin is its declaration's, empty on both hosts. It is optional
 * and on by default; switched off, page heads show whatever other family
 * contributes a backdrop, or none.
 */
import { declarationPlugin, defineExtension } from "@kb/contracts";
import { BACKDROP_OPTIONS, type SeedBackdrop } from "@kb/model";
import type { Plugin } from "@kb/plugin";

/** The Unicorn Studio scene over the tag/accent wash: the one a head shows while none is chosen. */
export const UNICORN_BACKDROP: SeedBackdrop = { id: "backdrops.unicorn", label: "Unicorn" };
/** The compact tag/accent wash alone. */
export const GRADIENT_BACKDROP: SeedBackdrop = { id: "backdrops.gradient", label: "Gradient" };

/** Bats against a moon glow by night, swallows against a sun glow by day: the open sky. */
export const SKY_BACKDROP: SeedBackdrop = { id: "backdrops.sky", label: "Sky" };

/** A house with bats hanging under its eaves: asleep by day, stirring and flying at night. */
export const ROOST_BACKDROP: SeedBackdrop = { id: "backdrops.roost", label: "Roost" };

/** A dark star drifting through a seeded nebula and bending its light; a write is a lensed supernova. */
export const LENS_BACKDROP: SeedBackdrop = { id: "backdrops.lens", label: "Lens" };

/** Gargantua: a black hole whose thick gas disk streams round it, its far side bent over the shadow. */
export const BLACK_HOLE_BACKDROP: SeedBackdrop = {
  id: "backdrops.black-hole",
  label: "Black hole",
};

export const backdropsExtension = defineExtension({
  name: "backdrops",
  label: "Backdrops",
  tags: ["backdrops"],
  optional: { byDefault: "on" },
  declaredOptions: [
    {
      kind: BACKDROP_OPTIONS,
      options: [
        UNICORN_BACKDROP,
        GRADIENT_BACKDROP,
        SKY_BACKDROP,
        ROOST_BACKDROP,
        LENS_BACKDROP,
        BLACK_HOLE_BACKDROP,
      ],
    },
  ],
});

/** The backdrops family's shared plugin: its declaration's, on either host. */
export function backdropsPlugin(): Plugin {
  return declarationPlugin(backdropsExtension);
}
