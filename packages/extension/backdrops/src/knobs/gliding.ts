/**
 * Gliding's own knobs (DESIGN-UI.md → Page-head backdrops → Knobs), after the
 * family's speed and seed (`MOVING_KNOBS`): each wired directly into the
 * painterly gouache ocean shader.
 */
import type { Knob, NumberKnob } from "@kb/model";

/** Sunlight warmth across the shallow turquoise pools and foam highlights: -1 crisp cool aqua, 0 tropical sunlit, +1 golden warmth. */
export const GLIDING_SUN_WARMTH_KNOB: NumberKnob = {
  kind: "number",
  id: "sun-warmth",
  label: "Sun warmth",
  min: -1,
  max: 1,
  step: 0.05,
  default: 0,
};

/** Sea-foam ribbon density and crest coverage across the ocean swells: 0 sparse wisps, 1 balanced ribbons, 2 rich crests. */
export const GLIDING_FOAM_KNOB: NumberKnob = {
  kind: "number",
  id: "foam",
  label: "Sea foam",
  min: 0,
  max: 2,
  step: 0.05,
  default: 1,
};

export const GLIDING_KNOBS: readonly Knob[] = [GLIDING_SUN_WARMTH_KNOB, GLIDING_FOAM_KNOB];
