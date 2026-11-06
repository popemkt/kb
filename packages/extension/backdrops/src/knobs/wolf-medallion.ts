/**
 * wolf-medallion's own knobs (DESIGN-UI.md → Page-head backdrops → Knobs), after the
 * family's speed and seed (`MOVING_KNOBS`): each wired to what its scene
 * draws, its default the scene as it was drawn before it had a knob.
 */
import type { Knob, NumberKnob } from "@kb/model";

/** How many embers rise: the share of their grid's cells that hold a spark, about the medallion and across the frame. */
export const MEDALLION_EMBERS_KNOB: NumberKnob = {
  kind: "number",
  id: "embers",
  label: "Embers",
  min: 0,
  max: 2,
  step: 0.05,
  default: 1,
  unit: "×",
};

/** How thick the smoke hangs, near and far; 0, the medallion in clear air. */
export const MEDALLION_SMOKE_KNOB: NumberKnob = {
  kind: "number",
  id: "smoke",
  label: "Smoke",
  min: 0,
  max: 1.75,
  step: 0.05,
  default: 1,
  unit: "×",
};

/** How present the circle of glyphs turning behind it is: their glow and its rings; 0, none. */
export const MEDALLION_GLYPHS_KNOB: NumberKnob = {
  kind: "number",
  id: "glyphs",
  label: "Glyph glow",
  min: 0,
  max: 2,
  step: 0.05,
  default: 1,
  unit: "×",
};

export const WOLF_MEDALLION_KNOBS: readonly Knob[] = [
  MEDALLION_EMBERS_KNOB,
  MEDALLION_SMOKE_KNOB,
  MEDALLION_GLYPHS_KNOB,
];
