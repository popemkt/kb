/**
 * The Black hole backdrop: Gargantua, a Schwarzschild black hole with a
 * thick, streaming gas disk (shader: `black-hole-shader.ts`), right of the
 * title, a little below the horizon of its own disk.
 *
 * The owner: the pointer tilts and swings the camera, slowly (a camera move,
 * not a cursor, M1); with no pointer the camera rests, breathing. Writes are
 * an impulse, never a restart: typing dims the disk a little and each
 * keystroke breathes into it; a write outside typing sets a hot flare
 * orbiting in it, which a further write brightens rather than starts again.
 *
 * Cost: the hole is drawn offscreen at a share of the frame's pixels, with a
 * step cap and samples per step, all three lowered as the stage's meter
 * lowers quality; the frames before it fill in what one frame's jittered
 * samples leave out.
 */
import { max, min, screenUV, vec2 } from "three/tsl";
import { offscreenPass, type OffscreenPass, type SceneStage } from "@kb/scene-gpu";
import type { Reactions } from "../scene/reactions";
import { seededRng } from "../scene/rng";
import {
  mountBackdrop,
  type BackdropLayout,
  type BackdropParts,
  type GpuBackdropInit,
  type GpuBackdropScene,
  type GpuLook,
  groundsOf,
} from "../gpu/gpu-scene";
import { blackHoleFragment, blackHoleUniforms } from "./black-hole-shader";

/**
 * How much of each new frame enters the picture; the rest is the frames
 * before. High: the history only settles the jitter, it must not smear the
 * streaming gas.
 */
const BLEND = 0.7;
/** How hard the upscale is sharpened (contrast-adaptive, see `sharpened`). */
const SHARPEN = 0.6;
/** The camera's follow (1/s): slow, a dolly rather than a cursor. */
const FOLLOW = 2.2;
/** Below this the flare is dark, and the next one may start elsewhere on its orbit. */
const FLARE_REST = 0.03;
/** The flare's phase is drawn from this mount's seed, anew for each flare. */
const FULL_TURN = Math.PI * 2;

/**
 * The hole's picture scaled to the frame and sharpened (after AMD's
 * contrast-adaptive sharpening): each pixel pushed away from its four
 * neighbours' mean, clamped to their range, so filaments and the photon
 * ring stay crisp without ringing.
 */
function sharpened(hole: OffscreenPass) {
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
  return centre.add(centre.sub(mean).mul(SHARPEN)).clamp(low, high);
}

function blackHole(stage: SceneStage, init: GpuBackdropInit): BackdropParts {
  const rng = seededRng(init.seed);
  const u = blackHoleUniforms();
  u.time.value = 120 + rng.range(0, 60);
  const hole = offscreenPass(
    stage.renderer,
    (inputs) => blackHoleFragment(u, inputs, groundsOf(stage)),
    {
      history: true,
    },
  );
  stage.scene.backgroundNode = sharpened(hole);

  const rest = { inclination: 0.105, azimuth: 0 };
  const camera = { ...rest };
  let width = 1;
  let height = 1;
  /** A fresh picture has no history to blend with. */
  let fresh = true;
  let elapsed = 0;

  return {
    panel: { x: 0.68, y: 0.3, scale: 0.62, presence: 0.72 },
    wide: { x: 0.63, y: 0.38, scale: 1, presence: 1 },
    layout: ({ width: w, height: h, quality, composition }: BackdropLayout) => {
      width = w;
      height = h;
      u.center.value.set(composition.x, 1 - composition.y);
      u.focal.value = 2.3 * composition.scale;
      // At full quality one texel a CSS pixel, sharpened; it falls with quality.
      const share = 0.55 + 0.45 * quality;
      hole.setSize(w * share, h * share);
      u.steps.value = Math.round(120 + 100 * quality);
      u.samples.value = quality > 0.8 || init.reducedMotion ? 2 : 1;
      fresh = true;
    },
    setLook: (look: GpuLook) => {
      u.dark.value = look.dark ? 1 : 0;
      stage.setBloom(look.dark ? 0.18 : 0.06);
      fresh = true;
    },
    frame: (dt: number, reactions: Reactions) => {
      elapsed += dt;
      u.time.value += dt;
      u.calm.value = reactions.calm;
      u.pulse.value = reactions.impulse;
      // A flare starting from dark is set somewhere new on its orbit; a further write brightens it.
      if (u.flare.value < FLARE_REST && reactions.stir >= FLARE_REST) {
        u.flarePhase.value = rng.range(0, FULL_TURN);
      }
      u.flare.value = reactions.stir;
      const pointer = reactions.pointer;
      const aim =
        pointer.near > 0.05
          ? {
              inclination: 0.06 + 0.16 * (1 - pointer.y / height),
              azimuth: (pointer.x / width - 0.6) * 0.5,
            }
          : {
              inclination: rest.inclination + 0.02 * Math.sin(elapsed * 0.07),
              azimuth: 0.08 * Math.sin(elapsed * 0.045),
            };
      const k = 1 - Math.exp(-dt * FOLLOW);
      camera.inclination += (aim.inclination - camera.inclination) * k;
      camera.azimuth += (aim.azimuth - camera.azimuth) * k;
      u.inclination.value = camera.inclination;
      u.azimuth.value = camera.azimuth;
      u.frame.value = (u.frame.value + (dt > 0 ? 1 : 0)) % 4096;
      u.blend.value = fresh || dt === 0 ? 1 : BLEND;
      hole.render();
      fresh = false;
    },
    dispose: hole.dispose,
  };
}

export function mountBlackHole(
  host: HTMLElement,
  init: GpuBackdropInit,
): Promise<GpuBackdropScene> {
  return mountBackdrop(
    host,
    init,
    {
      // A tight bloom and fine grain: high definition, like the film, never a haze.
      bloom: { strength: 0.18, radius: 0.25 },
      lens: { aberration: 0.012, streak: 0.3, grain: 0.034 },
    },
    blackHole,
  );
}
