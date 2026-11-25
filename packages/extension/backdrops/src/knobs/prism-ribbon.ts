/**
 * Prism ribbon's own knobs (DESIGN-UI.md → Page-head backdrops → Knobs),
 * after the family's speed and seed (`MOVING_KNOBS`): each wired to what its
 * scene draws, its default the curated look.
 */
import type { Knob, NumberKnob } from "@kb/model";

/** The palette's hue, turned past the few degrees each load draws. */
export const PRISM_RIBBON_HUE_KNOB: NumberKnob = {
  kind: "number",
  id: "hue",
  label: "Hue",
  min: -60,
  max: 60,
  step: 5,
  default: 0,
  unit: "°",
};

/** How strongly the curved shader code and blueprint grid read on the ribbon surface. */
export const PRISM_RIBBON_CODE_KNOB: NumberKnob = {
  kind: "number",
  id: "code",
  label: "Code overlay",
  min: 0,
  max: 1.5,
  step: 0.05,
  default: 1,
  unit: "×",
};

/** How widely the specular highlight splits across coral, gold and midnight blue. */
export const PRISM_RIBBON_PRISM_KNOB: NumberKnob = {
  kind: "number",
  id: "prism",
  label: "Prism shift",
  min: 0,
  max: 1.5,
  step: 0.05,
  default: 1,
  unit: "×",
};

export const PRISM_RIBBON_KNOBS: readonly Knob[] = [
  PRISM_RIBBON_HUE_KNOB,
  PRISM_RIBBON_CODE_KNOB,
  PRISM_RIBBON_PRISM_KNOB,
];
