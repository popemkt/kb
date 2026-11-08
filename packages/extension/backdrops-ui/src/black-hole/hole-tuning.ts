/**
 * What each Black hole look's own knobs (`GARGANTUA_KNOBS`, `WARP_KNOBS`)
 * make of it, as the numbers the look sets on its uniforms: each at its
 * default leaves the look as it was drawn before it had a knob. The knob
 * both looks share, the tilt, is the rig's (`holeDolly`).
 */
import {
  GARGANTUA_BEAMING_KNOB,
  GARGANTUA_HEAT_KNOB,
  WARP_PULL_KNOB,
  WARP_STREAKS_KNOB,
} from "@kb/backdrops";
import { knobValue, type KnobValues } from "@kb/model";

/** Warp: within `WARP_HORIZON` of the hole the pull is whole; beyond its reach there is none. */
export const WARP_HORIZON = 0.8;
/** Warp's pull reaches this far at a pull of 1. */
const WARP_REACH = 2;
/** How far Warp's turbulence pushes its ramp at a streaks of 1: the streaks' contrast. */
const WARP_STREAKS = 0.4;

export interface GargantuaTuning {
  /** How much of the Doppler factor's cube the gas's light takes (0, none: an even disk). */
  readonly beaming: number;
  /** The gas's temperature, scaled. */
  readonly heat: number;
}

export function gargantuaTuning(knobs: KnobValues): GargantuaTuning {
  return {
    beaming: knobValue(knobs, GARGANTUA_BEAMING_KNOB),
    heat: knobValue(knobs, GARGANTUA_HEAT_KNOB),
  };
}

export interface WarpTuning {
  /** The streaks' contrast. */
  readonly streaks: number;
  /** How far out the pull reaches, in tenths of the camera's distance. */
  readonly reach: number;
}

export function warpTuning(knobs: KnobValues): WarpTuning {
  return {
    streaks: WARP_STREAKS * knobValue(knobs, WARP_STREAKS_KNOB),
    reach: WARP_REACH * knobValue(knobs, WARP_PULL_KNOB),
  };
}
