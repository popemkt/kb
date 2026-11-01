/**
 * Gargantua, a look of the Black hole backdrop: a Schwarzschild black hole
 * with a thick, streaming gas disk (shader: `black-hole-shader.ts`).
 *
 * The owner (through the shared rig, `hole-rig.ts`): the pointer tilts and
 * swings the camera; typing dims the disk a little and each keystroke
 * breathes into it; a write outside typing sets a hot flare orbiting in it.
 *
 * Cost: the hole is drawn offscreen, and what the meter trades is its
 * resolution and nothing else (`holeDensity`). A ray's steps are never cut
 * short (`STEP_CAP`): the rays that wind round the hole take the most, and
 * they are the photon ring. One jittered sample a step; the frames before it
 * fill in what one frame's samples leave out.
 */
import { offscreenPass, type SceneStage, type StageLens } from "@kb/scene-gpu";
import type { Reactions } from "../scene/reactions";
import type { Variation } from "../scene/seed";
import {
  type BackdropLayout,
  type GpuBackdropInit,
  type GpuLook,
  groundsOf,
} from "../gpu/gpu-scene";
import { blackHoleFragment, blackHoleUniforms } from "./black-hole-shader";
import { flareOrbit, holeDensity, holeDolly, sharpened, type HoleLook } from "./hole-rig";

/**
 * How much of each new frame enters the picture; the rest is the frames
 * before. High: the history only settles the jitter, it must not smear the
 * streaming gas.
 */
const BLEND = 0.7;
/** How hard the upscale is sharpened (contrast-adaptive, see `sharpened`). */
const SHARPEN = 0.6;
/** The hole's texels per CSS pixel at full quality. */
const DENSITY = 1.5;
/** A fine colour split, a streak drawn out of the tight bloom, fine grain: the film's camera. */
export const GARGANTUA_LENS: StageLens = { aberration: 0.012, streak: 0.3, grain: 0.034 };
/**
 * Enough steps for a ray that winds round the photon sphere: fewer, and the
 * photon ring is the first thing lost. Rays that miss break out long before
 * it, so the cap costs little.
 */
const STEP_CAP = 300;

export function gargantua(stage: SceneStage, init: GpuBackdropInit, vary: Variation): HoleLook {
  const flare = flareOrbit(vary);
  const u = blackHoleUniforms();
  u.time.value = 120 + vary.range("clock", 0, 60);
  const hole = offscreenPass(
    stage.renderer,
    (inputs) => blackHoleFragment(u, inputs, groundsOf(stage)),
    {
      history: true,
    },
  );
  stage.scene.backgroundNode = sharpened(hole, SHARPEN);

  const dolly = holeDolly({ inclination: 0.105, azimuth: 0 });
  let width = 1;
  let height = 1;
  /** A fresh picture has no history to blend with. */
  let fresh = true;

  return {
    layout: ({ width: w, height: h, quality, anchor }: BackdropLayout) => {
      width = w;
      height = h;
      // The shader reads the hole's centre as shares of the frame, y up.
      u.center.value.set(0.5 + anchor.x / (w / h), 0.5 + anchor.y);
      u.focal.value = 2.3 * anchor.scale;
      const density = holeDensity(quality, DENSITY);
      hole.setSize(w * density, h * density);
      u.steps.value = STEP_CAP;
      // A still frame has no frames before it to settle its samples.
      u.samples.value = init.reducedMotion ? 3 : 1;
      fresh = true;
      return anchor;
    },
    setLook: (look: GpuLook) => {
      u.dark.value = look.dark ? 1 : 0;
      stage.setBloom(look.dark ? 0.18 : 0.06);
      stage.setLens(GARGANTUA_LENS);
      fresh = true;
    },
    frame: (dt: number, reactions: Reactions) => {
      u.time.value += dt;
      u.calm.value = reactions.calm;
      u.pulse.value = reactions.impulse;
      const flaring = flare.follow(reactions);
      u.flare.value = flaring.level;
      u.flarePhase.value = flaring.phase;
      const view = dolly.follow(dt, reactions, { width, height });
      u.inclination.value = view.inclination;
      u.azimuth.value = view.azimuth;
      u.frame.value = (u.frame.value + (dt > 0 ? 1 : 0)) % 4096;
      u.blend.value = fresh || dt === 0 ? 1 : BLEND;
      hole.render();
      fresh = false;
    },
    dispose: hole.dispose,
  };
}
