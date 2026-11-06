/**
 * light-trails's own knobs (DESIGN-UI.md → Page-head backdrops → Knobs), after the
 * family's speed and seed (`MOVING_KNOBS`): each wired to what its scene
 * draws, its default the scene as it was drawn before it had a knob.
 */
import type { Knob, NumberKnob } from "@kb/model";

/** How many strands are shown, near, mid and far alike; its most is how many the scene lays out. */
export const TRAILS_STRANDS_KNOB: NumberKnob = {
  kind: "number",
  id: "strands",
  label: "Strands",
  min: 8,
  max: 25,
  step: 1,
  default: 25,
};

/** How far the strands fan out away from the knot: the bundle tighter or more open toward the frame's sides. */
export const TRAILS_FAN_KNOB: NumberKnob = {
  kind: "number",
  id: "fan",
  label: "Fan",
  min: 0.5,
  max: 1.5,
  step: 0.05,
  default: 1,
  unit: "×",
};

/** How bright the knot burns: its core, its bloom and its lens streaks. */
export const TRAILS_KNOT_KNOB: NumberKnob = {
  kind: "number",
  id: "knot",
  label: "Knot",
  min: 0.25,
  max: 2,
  step: 0.05,
  default: 1,
  unit: "×",
};

export const LIGHT_TRAILS_KNOBS: readonly Knob[] = [
  TRAILS_STRANDS_KNOB,
  TRAILS_FAN_KNOB,
  TRAILS_KNOT_KNOB,
];
