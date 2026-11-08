/**
 * lens's own knobs (DESIGN-UI.md → Page-head backdrops → Knobs), after the
 * family's speed and seed (`MOVING_KNOBS`): each wired to what its scene
 * draws, its default the scene as it was drawn before it had a knob.
 */
import type { Knob, NumberKnob } from "@kb/model";

/** The dark star's mass: its Einstein radius, so its shadow, its ring and how far it bends the nebula. */
export const LENS_MASS_KNOB: NumberKnob = {
  kind: "number",
  id: "mass",
  label: "Star mass",
  min: 0.6,
  max: 1.3,
  step: 0.05,
  default: 1,
  unit: "×",
};

/** The nebula's dyes turned round the colour wheel from the palette the seed drew. */
export const LENS_HUE_KNOB: NumberKnob = {
  kind: "number",
  id: "hue",
  label: "Nebula hue",
  min: -180,
  max: 180,
  step: 5,
  default: 0,
  unit: "°",
};

/** How many stars shine behind the nebula, against the density the seed drew. */
export const LENS_STARS_KNOB: NumberKnob = {
  kind: "number",
  id: "stars",
  label: "Stars",
  min: 0.25,
  max: 2,
  step: 0.05,
  default: 1,
  unit: "×",
};

export const LENS_KNOBS: readonly Knob[] = [LENS_MASS_KNOB, LENS_HUE_KNOB, LENS_STARS_KNOB];
