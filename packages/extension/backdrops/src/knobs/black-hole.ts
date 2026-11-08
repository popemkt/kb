/**
 * The Black hole's own knobs (DESIGN-UI.md → Page-head backdrops → Knobs),
 * after the family's speed and seed (`MOVING_KNOBS`): the backdrop's, shown
 * with either look, and each look's own (`BackdropVariant.knobs`), its
 * defaults the look as it was drawn before it had a knob.
 */
import type { Knob, NumberKnob } from "@kb/model";

/** How far above its disk the camera looks down, whichever look: the rig's inclination, scaled. */
export const BLACK_HOLE_TILT_KNOB: NumberKnob = {
  kind: "number",
  id: "tilt",
  label: "Tilt",
  min: 0.75,
  max: 1.75,
  step: 0.05,
  default: 1,
  unit: "×",
};

/** Gargantua's Doppler beaming: how much brighter the gas coming toward us is than the gas going away. */
export const GARGANTUA_BEAMING_KNOB: NumberKnob = {
  kind: "number",
  id: "beaming",
  label: "Beaming",
  min: 0,
  max: 1,
  step: 0.05,
  default: 0.75,
};

/** Gargantua's gas temperature: redder below 1, whiter and bluer above. */
export const GARGANTUA_HEAT_KNOB: NumberKnob = {
  kind: "number",
  id: "heat",
  label: "Heat",
  min: 0.6,
  max: 1.6,
  step: 0.05,
  default: 1,
  unit: "×",
};

/** Warp's streaks: how hard the turbulence pushes the disk's ramp, so how bright and broken its bands run. */
export const WARP_STREAKS_KNOB: NumberKnob = {
  kind: "number",
  id: "streaks",
  label: "Streaks",
  min: 0.5,
  max: 1.5,
  step: 0.05,
  default: 1,
  unit: "×",
};

/** Warp's pull: how far out the hole bends what lies behind it, so how high the arch and wide the wash. */
export const WARP_PULL_KNOB: NumberKnob = {
  kind: "number",
  id: "pull",
  label: "Pull",
  min: 0.7,
  max: 1.4,
  step: 0.05,
  default: 1,
  unit: "×",
};

export const BLACK_HOLE_KNOBS: readonly Knob[] = [BLACK_HOLE_TILT_KNOB];
export const GARGANTUA_KNOBS: readonly Knob[] = [GARGANTUA_BEAMING_KNOB, GARGANTUA_HEAT_KNOB];
export const WARP_KNOBS: readonly Knob[] = [WARP_STREAKS_KNOB, WARP_PULL_KNOB];
