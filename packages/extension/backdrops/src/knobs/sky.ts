/**
 * Sky's own knobs (DESIGN-UI.md → Page-head backdrops → Knobs), after the
 * family's speed and seed (`MOVING_KNOBS`): each wired to what its scene
 * draws, its default the scene as it was drawn before it had a knob.
 */
import type { Knob, NumberKnob } from "@kb/model";

/** How many fly, against the strength's flock: never fewer than three. */
export const SKY_FLOCK_KNOB: NumberKnob = {
  kind: "number",
  id: "flock",
  label: "Flock size",
  min: 0.5,
  max: 1.5,
  step: 0.1,
  default: 1,
  unit: "×",
};

/** How large the moon or the sun is, and how far its glow reaches. */
export const SKY_GLOW_KNOB: NumberKnob = {
  kind: "number",
  id: "glow",
  label: "Glow size",
  min: 0.7,
  max: 1.3,
  step: 0.05,
  default: 1,
  unit: "×",
};

/** How many stars by night, or motes of dust by day, against the strength's; 0 none. */
export const SKY_MOTES_KNOB: NumberKnob = {
  kind: "number",
  id: "motes",
  label: "Stars and dust",
  min: 0,
  max: 1.5,
  step: 0.1,
  default: 1,
  unit: "×",
};

export const SKY_KNOBS: readonly Knob[] = [SKY_FLOCK_KNOB, SKY_GLOW_KNOB, SKY_MOTES_KNOB];
