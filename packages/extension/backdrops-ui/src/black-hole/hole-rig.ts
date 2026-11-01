/**
 * What every look of the Black hole backdrop shares (`black-hole-scene.ts`):
 * the camera on its sphere round the hole and how the owner moves it, the
 * flare a write sets orbiting in the disk, and how the hole's offscreen
 * picture trades resolution for time and is scaled back up to the frame.
 *
 * A look owns its picture; this owns the rig it is seen through.
 */
import { max, min, screenUV, vec2 } from "three/tsl";
import type { OffscreenPass, SceneStage } from "@kb/scene-gpu";
import type { BackdropParts, GpuBackdropInit } from "../gpu/gpu-scene";
import type { Reactions } from "../scene/reactions";
import type { Variation } from "../scene/seed";

/**
 * A look of the hole: its picture, laid out and run as a backdrop's parts
 * are, in the composition the backdrop holds for all its looks.
 */
export type HoleLook = Omit<BackdropParts, "panel" | "wide" | "ready">;

/** How a look is built on the stage, from this mount's init and its draws. */
export type HoleLookBuild = (stage: SceneStage, init: GpuBackdropInit, vary: Variation) => HoleLook;

/** Where the camera stands on its sphere round the hole (radians). */
export interface HoleView {
  readonly inclination: number;
  readonly azimuth: number;
}

/** The camera's follow (1/s): slow, a dolly rather than a cursor. */
const FOLLOW = 2.2;

/**
 * The camera's dolly: with the pointer over the frame it tilts with the
 * pointer's height and swings with its place across; with none it rests at
 * `rest`, breathing on two unrelated slow periods. Either way it eases
 * there on elapsed time, so the path is the same at any frame rate.
 */
export function holeDolly(rest: HoleView) {
  let inclination = rest.inclination;
  let azimuth = rest.azimuth;
  let elapsed = 0;
  return {
    follow: (
      dt: number,
      reactions: Reactions,
      frame: { readonly width: number; readonly height: number },
    ): HoleView => {
      elapsed += dt;
      const pointer = reactions.pointer;
      const aim =
        pointer.near > 0.05
          ? {
              inclination: 0.06 + 0.16 * (1 - pointer.y / frame.height),
              azimuth: (pointer.x / frame.width - 0.6) * 0.5,
            }
          : {
              inclination: rest.inclination + 0.02 * Math.sin(elapsed * 0.07),
              azimuth: rest.azimuth + 0.08 * Math.sin(elapsed * 0.045),
            };
      const k = 1 - Math.exp(-dt * FOLLOW);
      inclination += (aim.inclination - inclination) * k;
      azimuth += (aim.azimuth - azimuth) * k;
      return { inclination, azimuth };
    },
  };
}

/** Below this the flare is dark, and the next one may start elsewhere on its orbit. */
const FLARE_REST = 0.03;
const FULL_TURN = Math.PI * 2;

/**
 * The flare a write sets orbiting in the disk: as bright as the owner's
 * stir, and set somewhere new on its orbit (drawn from this mount's seed)
 * each time it starts from dark; a further write only brightens it.
 */
export function flareOrbit(vary: Variation) {
  const flares = vary.stream("flares");
  let level = 0;
  let phase = 0;
  return {
    follow: (reactions: Reactions): { readonly level: number; readonly phase: number } => {
      if (level < FLARE_REST && reactions.stir >= FLARE_REST) phase = flares.range(0, FULL_TURN);
      level = reactions.stir;
      return { level, phase };
    },
  };
}

/**
 * The hole's texels per CSS pixel at `quality` (0.4–1): crisp first. Never
 * under one a CSS pixel, however long frames run; `top` at full quality,
 * capped at the screen's own density.
 */
export function holeDensity(quality: number, top: number): number {
  const screen = Math.max(1, globalThis.devicePixelRatio || 1);
  return Math.min(1 + ((top - 1) * Math.max(0, quality - 0.4)) / 0.6, screen);
}

/**
 * The hole's picture scaled to the frame and sharpened by `amount` (after
 * AMD's contrast-adaptive sharpening): each pixel pushed away from its four
 * neighbours' mean, clamped to their range, so fine light (filaments, the
 * photon ring) stays crisp without ringing.
 */
export function sharpened(hole: OffscreenPass, amount: number) {
  const at = vec2(screenUV.x, screenUV.y.oneMinus());
  const texel = vec2(1, 1).div(hole.size);
  const centre = hole.picture(at).rgb;
  const n = hole.picture(at.add(vec2(0, texel.y))).rgb;
  const s = hole.picture(at.sub(vec2(0, texel.y))).rgb;
  const e = hole.picture(at.add(vec2(texel.x, 0))).rgb;
  const w = hole.picture(at.sub(vec2(texel.x, 0))).rgb;
  const mean = n.add(s).add(e).add(w).mul(0.25);
  const low = min(min(n, s), min(e, w)).min(centre);
  const high = max(max(n, s), max(e, w)).max(centre);
  return centre.add(centre.sub(mean).mul(amount)).clamp(low, high);
}
