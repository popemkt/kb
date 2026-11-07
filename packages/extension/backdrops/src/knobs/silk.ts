/**
 * silk's own knobs (DESIGN-UI.md → Page-head backdrops → Knobs), after the
 * family's speed and seed (`MOVING_KNOBS`): each wired to what its scene
 * draws, its default the scene as it was drawn before it had a knob.
 */
import type { Knob, NumberKnob } from "@kb/model";

/** Every ribbon's dyes turned round the colour wheel, past the few degrees the seed draws. */
export const SILK_HUE_KNOB: NumberKnob = {
  kind: "number",
  id: "hue",
  label: "Dye hue",
  min: -90,
  max: 90,
  step: 5,
  default: 0,
  unit: "°",
};

/** How much of the silk's thin-film colour plays in its sheen: 0 a plain satin. */
export const SILK_IRIDESCENCE_KNOB: NumberKnob = {
  kind: "number",
  id: "iridescence",
  label: "Iridescence",
  min: 0,
  max: 1.35,
  step: 0.05,
  default: 1,
  unit: "×",
};

export const SILK_KNOBS: readonly Knob[] = [SILK_HUE_KNOB, SILK_IRIDESCENCE_KNOB];
