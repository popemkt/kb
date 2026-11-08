/**
 * floating-geometry's own knobs (DESIGN-UI.md → Page-head backdrops → Knobs), after the
 * family's speed and seed (`MOVING_KNOBS`): each wired to what its scene
 * draws, its default the scene as it was drawn before it had a knob.
 */
import type { Knob, NumberKnob } from "@kb/model";

/** How deeply the glass is crumpled: how far its facets fold in depth, so how sharply each turns into and out of the light. */
export const GEOMETRY_CRUMPLE_KNOB: NumberKnob = {
  kind: "number",
  id: "crumple",
  label: "Crumple",
  min: 0.5,
  max: 1.5,
  step: 0.05,
  default: 1,
  unit: "×",
};

/** How hot the lamps behind the glass burn: the gold at its corners, along its seams and in the air round it. */
export const GEOMETRY_GOLD_KNOB: NumberKnob = {
  kind: "number",
  id: "gold",
  label: "Gold light",
  min: 0.7,
  max: 1.3,
  step: 0.05,
  default: 1,
  unit: "×",
};

/** How brightly the band of light sweeping across the glass glints in its seams; 0, no sweep. */
export const GEOMETRY_SWEEP_KNOB: NumberKnob = {
  kind: "number",
  id: "sweep",
  label: "Sweep",
  min: 0,
  max: 2,
  step: 0.05,
  default: 1,
  unit: "×",
};

export const FLOATING_GEOMETRY_KNOBS: readonly Knob[] = [
  GEOMETRY_CRUMPLE_KNOB,
  GEOMETRY_GOLD_KNOB,
  GEOMETRY_SWEEP_KNOB,
];
