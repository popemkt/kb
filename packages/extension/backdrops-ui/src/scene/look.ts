/**
 * What the page tells a 2D stage about how to paint (`stage.ts`), and when
 * it tells it nothing new. A look is laid out by the composition
 * (`Composition.configure`), so a look equal to the one drawn lays nothing
 * out again: a stir of stars or a fresh glow is never the price of a
 * setting that did not move.
 */
import { MOVING_KNOBS } from "@kb/backdrops";
import type { BackdropDirection, BackdropStrength } from "@kb/appearance";
import type { KnobValues } from "@kb/model";
import type { ScenePalette } from "./palette.ts";

export interface Look {
  readonly palette: ScenePalette;
  readonly direction: BackdropDirection;
  readonly strength: BackdropStrength;
  readonly presence: number;
  /** Its composition's own knobs' values (`compositionKnobs`): a composition reads each by the knob (`knobValue`). */
  readonly knobs: KnobValues;
}

/** The knobs the stage implements itself, for every composition: speed on its clock, seed on its mount. */
const STAGED = new Set(MOVING_KNOBS.map(({ id }) => id));

/** A backdrop's knob values less the stage's own (`MOVING_KNOBS`): what its composition reads. */
export function compositionKnobs(values: KnobValues): KnobValues {
  return Object.fromEntries(Object.entries(values).filter(([id]) => !STAGED.has(id)));
}

/** Palettes are plain colours, made afresh by every read of the tokens: the same when every colour is. */
const samePalette = (a: ScenePalette, b: ScenePalette) => JSON.stringify(a) === JSON.stringify(b);

function sameKnobs(a: KnobValues, b: KnobValues): boolean {
  const ids = Object.keys(a);
  return ids.length === Object.keys(b).length && ids.every((id) => a[id] === b[id]);
}

/** Whether `next` paints as `drawn` does (none drawn yet: never). */
export function sameLook(drawn: Look | null, next: Look): boolean {
  return (
    drawn !== null &&
    drawn.direction === next.direction &&
    drawn.strength === next.strength &&
    drawn.presence === next.presence &&
    samePalette(drawn.palette, next.palette) &&
    sameKnobs(drawn.knobs, next.knobs)
  );
}
