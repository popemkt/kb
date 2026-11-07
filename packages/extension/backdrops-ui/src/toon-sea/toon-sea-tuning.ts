/**
 * What the Toon sea's own knobs (`TOON_SEA_KNOBS`) make of its scene, as
 * the numbers its scene sets on its uniforms (`toon-sea-scene.ts`): each at
 * its default leaves the sea as it was drawn before it had a knob.
 */
import { TOON_SEA_CLOUDS_KNOB, TOON_SEA_FOAM_KNOB, TOON_SEA_WAVES_KNOB } from "@kb/backdrops";
import { knobValue, type KnobValues } from "@kb/model";

/** How far the foam knob moves the caps' threshold for each unit from its default. */
const FOAM_REACH = 0.06;

export interface ToonSeaTuning {
  /** The swell's amplitude, scaled. */
  readonly swell: number;
  /** The cumulus bank's tower profile, scaled. */
  readonly clouds: number;
  /** Added to the foam's thresholds (caps and trail): below 0, more foam breaks. */
  readonly foam: number;
}

export function toonSeaTuning(knobs: KnobValues): ToonSeaTuning {
  return {
    swell: knobValue(knobs, TOON_SEA_WAVES_KNOB),
    clouds: knobValue(knobs, TOON_SEA_CLOUDS_KNOB),
    foam: (TOON_SEA_FOAM_KNOB.default - knobValue(knobs, TOON_SEA_FOAM_KNOB)) * FOAM_REACH,
  };
}
