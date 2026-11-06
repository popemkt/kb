/**
 * gradient-orbs's own knobs (DESIGN-UI.md → Page-head backdrops → Knobs), after the
 * family's speed and seed (`MOVING_KNOBS`): each wired to what its scene
 * draws, its default the scene as it was drawn before it had a knob.
 */
import type { Knob, NumberKnob } from "@kb/model";

/** The whole picture's hue, turned past the few degrees each load turns it: the field, the orbs and their light together. */
export const ORBS_HUE_KNOB: NumberKnob = {
  kind: "number",
  id: "hue",
  label: "Hue",
  min: -60,
  max: 60,
  step: 1,
  default: 0,
  unit: "°",
};

/** How large the orbs are against the composition's: smaller only, since the great ones already reach as near the frame's bottom as they may. */
export const ORBS_SIZE_KNOB: NumberKnob = {
  kind: "number",
  id: "size",
  label: "Orb size",
  min: 0.6,
  max: 1,
  step: 0.05,
  default: 1,
  unit: "×",
};

/** How brightly the orbs glow: the light they spill into the field, and a little of their own faces. */
export const ORBS_GLOW_KNOB: NumberKnob = {
  kind: "number",
  id: "glow",
  label: "Glow",
  min: 0.25,
  max: 1.75,
  step: 0.05,
  default: 1,
  unit: "×",
};

export const GRADIENT_ORBS_KNOBS: readonly Knob[] = [ORBS_HUE_KNOB, ORBS_SIZE_KNOB, ORBS_GLOW_KNOB];
