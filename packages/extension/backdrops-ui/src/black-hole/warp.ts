/**
 * Warp, a look of the Black hole backdrop: the lens-warp black hole after
 * the demo in Bruno Simon's Awwwards 2022 workshop; code written for kb
 * (shader: `warp-shader.ts`). A streaked disk seen almost edge on, bent
 * over its shadow and folded under it by a pull toward the hole.
 *
 * The owner, through the shared rig (`hole-rig.ts`), as for every look: the
 * pointer tilts and swings the camera; typing dims the disk and each
 * keystroke breathes into its streaks; a write sets a hot knot orbiting.
 *
 * Seeded: where the camera rests (a little higher or lower, a little
 * round), the streaks' place in the noise and the clock they start at.
 *
 * Cost: no march and no history, so one pass of a few noise reads on the
 * disk's pixels, drawn offscreen at up to the screen's own density and
 * lowered by the meter.
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
import { flareOrbit, holeDensity, holeDolly, sharpened, type HoleLook } from "./hole-rig";
import { warpFragment, warpUniforms } from "./warp-shader";

/** The hole's texels per CSS pixel at full quality: the screen's own, where it has two. */
const DENSITY = 2;
/** A light sharpening of the upscale, only where the meter has lowered the density. */
const SHARPEN = 0.35;
/**
 * The reference's camera, toned down: a colour split toward the edges, no
 * streak (there is next to no bloom to draw it from), and on a dark page
 * grain that sparkles in the hot gas and leaves the dark clean. A light
 * page is all light, so there the grain is only fine and even.
 */
const LENS: StageLens = { aberration: 0.02, streak: 0, grain: 0.012, sparkle: 0.45 };
const LIGHT_LENS: StageLens = { aberration: 0.006, streak: 0, grain: 0.02 };

export function warp(stage: SceneStage, _init: GpuBackdropInit, vary: Variation): HoleLook {
  const flare = flareOrbit(vary);
  const u = warpUniforms();
  u.time.value = 60 + vary.range("clock", 0, 120);
  u.offset.value.set(vary.range("streaks", 0, 1), vary.range("infall", 0, 4));
  const hole = offscreenPass(
    stage.renderer,
    (inputs) => warpFragment(u, inputs, groundsOf(stage)),
    { history: false },
  );
  stage.scene.backgroundNode = sharpened(hole, SHARPEN);

  // Where the camera rests is the load's: about as high over the disk as the reference's.
  const dolly = holeDolly({
    inclination: vary.range("tilt", 0.058, 0.068),
    azimuth: vary.range("swing", -0.16, 0.16),
  });
  let width = 1;
  let height = 1;

  return {
    layout: ({ width: w, height: h, quality, anchor }: BackdropLayout) => {
      width = w;
      height = h;
      u.center.value.set(0.5 + anchor.x / (w / h), 0.5 + anchor.y);
      u.focal.value = 1.55 * anchor.scale;
      const density = holeDensity(quality, DENSITY);
      hole.setSize(w * density, h * density);
      return anchor;
    },
    setLook: (look: GpuLook) => {
      u.dark.value = look.dark ? 1 : 0;
      stage.setBloom(look.dark ? 0.015 : 0.02);
      stage.setLens(look.dark ? LENS : LIGHT_LENS);
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
      hole.render();
    },
    dispose: hole.dispose,
  };
}
