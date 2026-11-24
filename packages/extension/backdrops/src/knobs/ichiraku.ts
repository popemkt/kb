/**
 * Ichiraku's own Backdrop Studio knobs (DESIGN-UI.md → Page-head backdrops →
 * Knobs), after the family's speed and seed (`MOVING_KNOBS`).
 */
import type { Knob, NumberKnob } from "@kb/model";

/** Intensity of the backlit diagonal downpour and wet puddle ripples. */
export const ICHIRAKU_RAIN_KNOB: NumberKnob = {
  kind: "number",
  id: "rain",
  label: "Rain",
  min: 0,
  max: 2,
  step: 0.1,
  default: 1,
  unit: "×",
};

/** Glow intensity of the chartreuse 一楽/ラーメン signs, lanterns, and cyan visor/tank. */
export const ICHIRAKU_NEON_KNOB: NumberKnob = {
  kind: "number",
  id: "neon",
  label: "Neon",
  min: 0.4,
  max: 1.8,
  step: 0.05,
  default: 1,
  unit: "×",
};

/** Opacity of Blender's extracted interior Grease-Pencil ink creases & cyan grooves. */
export const ICHIRAKU_INK_KNOB: NumberKnob = {
  kind: "number",
  id: "ink",
  label: "Ink lines",
  min: 0,
  max: 1.5,
  step: 0.1,
  default: 1,
  unit: "×",
};

export const ICHIRAKU_KNOBS: readonly Knob[] = [
  ICHIRAKU_RAIN_KNOB,
  ICHIRAKU_NEON_KNOB,
  ICHIRAKU_INK_KNOB,
];
