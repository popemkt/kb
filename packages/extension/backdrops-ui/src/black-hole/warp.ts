/**
 * Warp, a look of the Black hole backdrop: a graphic lens seen almost edge
 * on through a thin, razor-bright disk (shader: `warp-shader.ts`). The look
 * is inspired by the black hole of Bruno Simon's Awwwards 2022 workshop;
 * the code is kb's own.
 *
 * The owner, through the shared rig (`hole-rig.ts`), as for every look: the
 * pointer tilts and swings the camera; typing dims the disk and each
 * keystroke breathes into its streaks; a write sets a hot knot orbiting.
 *
 * Seeded: where the camera rests, the streaks' place in the noise, the
 * clock they start at, and a small turn of the violet tail's hue.
 *
 * Cost: no march and no history, so one pass of a few noise reads on the
 * disk's pixels, drawn offscreen at up to the screen's own density (the
 * photon ring is a texel wide) and lowered by the meter.
 */
import { offscreenPass, type SceneStage } from "@kb/scene-gpu";
import type { Reactions } from "../scene/reactions";
import { turnHue, type Variation } from "../scene/seed";
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
/** The violet tail before its turn (linear). */
const TAIL: readonly [number, number, number] = [0.42, 0.13, 0.72];

export function warp(stage: SceneStage, _init: GpuBackdropInit, vary: Variation): HoleLook {
  const flare = flareOrbit(vary);
  const u = warpUniforms();
  u.time.value = 60 + vary.range("clock", 0, 120);
  u.offset.value.set(vary.range("streaks", 0, 1), vary.range("infall", 0, 4));
  const [r, g, b] = turnHue(TAIL, vary.range("tail", -0.28, 0.22));
  u.tail.value.setRGB(Math.max(r, 0), Math.max(g, 0), Math.max(b, 0));
  const hole = offscreenPass(
    stage.renderer,
    (inputs) => warpFragment(u, inputs, groundsOf(stage)),
    { history: false },
  );
  stage.scene.backgroundNode = sharpened(hole, SHARPEN);

  // Where the camera rests is the load's: a little higher or lower, a little round.
  const dolly = holeDolly({
    inclination: vary.range("tilt", 0.07, 0.11),
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
      stage.setBloom(look.dark ? 0.1 : 0.04);
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
