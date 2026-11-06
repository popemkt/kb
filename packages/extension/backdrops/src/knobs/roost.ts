/**
 * Roost's own knobs (DESIGN-UI.md → Page-head backdrops → Knobs), after the
 * family's speed and seed (`MOVING_KNOBS`): each wired to what its scene
 * draws, its default the scene as it was drawn before it had a knob.
 */
import type { Knob, NumberKnob } from "@kb/model";

/**
 * How many bats roost, against the strength's: never fewer than three, and
 * never more, since the eave holds no more without crowding.
 */
export const ROOST_BATS_KNOB: NumberKnob = {
  kind: "number",
  id: "bats",
  label: "Bats",
  min: 0.3,
  max: 1,
  step: 0.1,
  default: 1,
  unit: "×",
};

/** How warmly the one window glows by night; 0 dark. By day no window is lit. */
export const ROOST_WINDOW_KNOB: NumberKnob = {
  kind: "number",
  id: "window",
  label: "Window glow",
  min: 0,
  max: 1.5,
  step: 0.1,
  default: 1,
  unit: "×",
};

export const ROOST_KNOBS: readonly Knob[] = [ROOST_BATS_KNOB, ROOST_WINDOW_KNOB];
