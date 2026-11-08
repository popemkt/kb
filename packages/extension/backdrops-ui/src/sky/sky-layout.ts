/**
 * Where Sky's light stands and how much flies and glitters in it, for a
 * frame and its knobs: pure, so the scene (`sky-scene.ts`) lays itself out
 * from it and a test reads what a knob moves.
 */
import { SKY_FLOCK_KNOB, SKY_GLOW_KNOB, SKY_MOTES_KNOB } from "@kb/backdrops";
import { knobValue } from "@kb/model";
import type { SceneConfig } from "../scene/composition";
import type { GlowSpec } from "../scene/glow";
import type { ScenePalette } from "../scene/palette";

/** Fliers at each strength, before quality and the flock knob scale them. */
const FLOCK = { subtle: 4, soft: 6, vivid: 9 } as const;
/** Stars or dust at each strength, before quality and the motes knob scale them. */
const MOTES = { subtle: 14, soft: 22, vivid: 30 } as const;

/** What Sky lays itself out against: its frame, its look and its knobs. */
export type SkyFrame = Pick<
  SceneConfig,
  "width" | "height" | "direction" | "strength" | "quality" | "knobs"
> & { readonly palette: Pick<ScenePalette, "dark"> };

/** The moon by night, the sun by day: right of centre, toward the head's direction, sized by the glow knob. */
export function skyLayout(config: SkyFrame): GlowSpec {
  const { width, height, direction, palette } = config;
  const scale = Math.min(1, width / 800);
  const size = knobValue(config.knobs, SKY_GLOW_KNOB);
  return {
    x: width * 0.63,
    y: height * (direction === "down" ? 0.34 : 0.66),
    reach: Math.min(width * 0.52, height * 1.25) * size,
    disc: (palette.dark ? 34 : 38) * scale * size,
    squash: 1,
    power: palette.dark ? 4.2 : 3,
    intensity: palette.dark ? 1 : 1.4,
    washFrom: direction === "down" ? "top" : "bottom",
  };
}

/** How many fly: the strength's flock, at the detail the stage affords, by the flock knob; never fewer than three. */
export function flockSize(config: SkyFrame): number {
  const flock = knobValue(config.knobs, SKY_FLOCK_KNOB);
  return Math.max(3, Math.round(FLOCK[config.strength] * config.quality * flock));
}

/** How many stars or motes of dust: the strength's, at the detail the stage affords, by the motes knob. */
export function moteCount(config: SkyFrame): number {
  const motes = knobValue(config.knobs, SKY_MOTES_KNOB);
  return Math.round(MOTES[config.strength] * config.quality * motes);
}
