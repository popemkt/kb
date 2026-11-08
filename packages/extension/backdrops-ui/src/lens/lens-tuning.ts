/**
 * What the Lens's own knobs (`LENS_KNOBS`) make of its scene, as plain
 * numbers its scene sets on its uniforms (`lens-scene.ts`): each knob at its
 * default leaves what the seed drew exactly as it was.
 */
import { LENS_HUE_KNOB, LENS_MASS_KNOB, LENS_STARS_KNOB } from "@kb/backdrops";
import { knobValue, type KnobValues } from "@kb/model";
import { turnHue } from "../scene/seed";

type Rgb = readonly [number, number, number];

/** The dark star's Einstein radius at full scale, frame heights. */
const EINSTEIN = 0.15;

export interface LensTuning {
  /** θE at full scale: the star's mass. */
  readonly einstein: number;
  /** A dye of the drawn palette, turned round the wheel: linear, never below black. */
  readonly dye: (rgb: Rgb) => [number, number, number];
  /** The star cut for the one the seed drew: the share of cells with no star. */
  readonly starCut: (drawn: number) => number;
}

export function lensTuning(knobs: KnobValues): LensTuning {
  const mass = knobValue(knobs, LENS_MASS_KNOB);
  const hue = (knobValue(knobs, LENS_HUE_KNOB) * Math.PI) / 180;
  const stars = knobValue(knobs, LENS_STARS_KNOB);
  return {
    einstein: EINSTEIN * mass,
    // A turn about the grey axis can take a saturated dye below black on a channel.
    dye: (rgb) => {
      const [r, g, b] = turnHue(rgb, hue);
      return [Math.max(0, r), Math.max(0, g), Math.max(0, b)];
    },
    // The share of cells that hold a star, scaled: at 1 the drawn cut itself.
    starCut: (drawn) => drawn + (1 - drawn) * (1 - stars),
  };
}
