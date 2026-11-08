/**
 * toon-sea's own knobs (DESIGN-UI.md → Page-head backdrops → Knobs), after the
 * family's speed and seed (`MOVING_KNOBS`): each wired to what its scene
 * draws, its default the scene as it was drawn before it had a knob.
 */
import type { Knob, NumberKnob } from "@kb/model";

/** The swell's height: every wave's amplitude, so its slopes, its lit bands and its wave lines. */
export const TOON_SEA_WAVES_KNOB: NumberKnob = {
  kind: "number",
  id: "waves",
  label: "Wave height",
  min: 0.4,
  max: 1.6,
  step: 0.05,
  default: 1,
  unit: "×",
};

/** How high the cumulus bank towers over the horizon. */
export const TOON_SEA_CLOUDS_KNOB: NumberKnob = {
  kind: "number",
  id: "clouds",
  label: "Cloud height",
  min: 0.5,
  max: 1.3,
  step: 0.05,
  default: 1,
  unit: "×",
};

/** How much foam breaks on the crests and trails behind them: 0 the least, 2 the most. */
export const TOON_SEA_FOAM_KNOB: NumberKnob = {
  kind: "number",
  id: "foam",
  label: "Foam",
  min: 0,
  max: 2,
  step: 0.1,
  default: 1,
};

export const TOON_SEA_KNOBS: readonly Knob[] = [
  TOON_SEA_WAVES_KNOB,
  TOON_SEA_CLOUDS_KNOB,
  TOON_SEA_FOAM_KNOB,
];
