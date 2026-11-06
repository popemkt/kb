/**
 * What the Silk's own knobs (`SILK_KNOBS`) make of its scene, as the numbers
 * its scene sets (`silk-scene.ts`): each at its default leaves the silk as
 * it was drawn before it had a knob.
 */
import { SILK_HUE_KNOB, SILK_IRIDESCENCE_KNOB } from "@kb/backdrops";
import { knobValue, type KnobValues } from "@kb/model";

/** The thin film's share of the silk's sheen at an iridescence of 1, on each page. */
export const SILK_FILM_MIX = { light: 0.72, dark: 0.62 } as const;

export interface SilkTuning {
  /** Radians the dyes turn, past the seed's own few degrees. */
  readonly hue: number;
  /** The film's share of the sheen, scaled (`SILK_FILM_MIX`). */
  readonly iridescence: number;
}

export function silkTuning(knobs: KnobValues): SilkTuning {
  return {
    hue: (knobValue(knobs, SILK_HUE_KNOB) * Math.PI) / 180,
    iridescence: knobValue(knobs, SILK_IRIDESCENCE_KNOB),
  };
}
