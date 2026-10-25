/**
 * The Toon sea backdrop: an open sea under anime-game cumulus, at night a
 * moonlit indigo with bioluminescent wakes (shaders: `toon-sea-shader.ts`).
 * The sky is drawn offscreen at a share of the frame's pixels a few times a
 * second, the sea every frame from it.
 *
 * The owner: ripple rings spread from where the pointer rests over the
 * water; typing calms the swell and slows the sea a little; the owner's
 * activity (`reactions.impulse`) rolls splash rings out with bursts of
 * glints, as many and as bright as it is high. Nothing is ever restarted:
 * the rings run on one clock that only runs forward, and the activity only
 * scales them.
 */
import { offscreenPass, type SceneStage } from "@kb/scene-gpu";
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
import { SPLASHES, seaFrame, skyFragment, toonSeaUniforms } from "./toon-sea-shader";

/** The horizon, as a share of the frame's height from its bottom. */
const HORIZON = 0.6;
/** A splash ring's life (s): the rings take turns through it. */
const SPLASH_CYCLE = 6;
/** The sky is redrawn this often (s): it moves a pixel every few seconds. */
const SKY_EVERY = 0.06;

function toonSea(stage: SceneStage, init: GpuBackdropInit): BackdropParts {
  const rng = seededRng(init.seed);
  const u = toonSeaUniforms();
  u.time.value = 30 + rng.range(0, 240);
  u.horizon.value = HORIZON;
  /** The splash rings' one clock: each ring is a phase of it, so none ever starts over. */
  let splashClock = rng.range(0, SPLASH_CYCLE);
  const splashAt = (cycle: number, ring: number) => {
    // Where a ring's cycle lands, from a hash of the cycle: the same every time it is asked.
    const h = (n: number) => {
      const v = Math.sin(n * 127.1 + init.seed * 0.013) * 43758.5453;
      return v - Math.floor(v);
    };
    return {
      x: 0.45 + 0.4 * h(cycle * 3 + ring),
      y: HORIZON - 0.12 - 0.1 * h(cycle * 3 + ring + 1.7),
    };
  };

  const sky = offscreenPass(stage.renderer, (inputs) => skyFragment(u, inputs), { history: false });
  stage.scene.backgroundNode = seaFrame(u, sky.picture, groundsOf(stage));

  let width = 1;
  let height = 1;
  let sinceSky = Infinity;

  return {
    // The sun (the moon) stands high and right; in a panel a little lower in its corner.
    panel: { x: 0.72, y: 0.17, scale: 0.85, presence: 1 },
    wide: { x: 0.74, y: 0.15, scale: 1, presence: 1 },
    layout: ({ width: w, height: h, quality, composition }: BackdropLayout) => {
      width = w;
      height = h;
      u.aspect.value = w / h;
      u.size.value.set(w, h);
      u.sun.value.set(composition.x, 1 - composition.y);
      u.scrim.layout(w, h);
      u.detail.value = quality;
      // The sky is soft: at full quality two texels for three device pixels (the stage's ratio,
      // at most 2), so the clouds' outlines stay clean when it is scaled up.
      const share = Math.min(window.devicePixelRatio || 1, 2) * 0.67 * (0.6 + 0.4 * quality);
      sky.setSize(w * share, h * share);
      sinceSky = Infinity;
    },
    setLook: (look: GpuLook) => {
      u.dark.value = look.dark ? 1 : 0;
      stage.setBloom(look.dark ? 0.22 : 0.12);
      sinceSky = Infinity;
    },
    frame: (dt: number, reactions: Reactions) => {
      // The clock only runs forward; typing slows it a little and calms the swell.
      u.time.value += dt * (1 - 0.45 * reactions.calm);
      u.calm.value = reactions.calm;
      splashClock += dt;
      const level = Math.min(1.2, reactions.impulse);
      u.splashes.forEach((splash, ring) => {
        const t = splashClock + (ring * SPLASH_CYCLE) / SPLASHES;
        const cycle = Math.floor(t / SPLASH_CYCLE);
        const age = t - cycle * SPLASH_CYCLE;
        const at = splashAt(cycle, ring);
        // A ring grows in from nothing, so a new cycle's place never shows as a jump.
        splash.value.set(at.x, at.y, age, level * Math.min(1, age / 0.4));
      });
      const pointer = reactions.pointer;
      const px = pointer.x / width;
      const py = 1 - pointer.y / height;
      const over = pointer.near > 0.05 && py < HORIZON - 0.01;
      const k = 1 - Math.exp(-dt * 5);
      const ptr = u.pointer.value;
      if (over) ptr.set(ptr.x + (px - ptr.x) * k, ptr.y + (py - ptr.y) * k, ptr.z);
      ptr.z += ((over ? pointer.near : 0) - ptr.z) * k;
      sinceSky += dt;
      if (sinceSky >= SKY_EVERY || dt === 0) {
        sky.render();
        sinceSky = 0;
      }
    },
    dispose: sky.dispose,
  };
}

export function mountToonSea(host: HTMLElement, init: GpuBackdropInit): Promise<GpuBackdropScene> {
  return mountBackdrop(
    host,
    init,
    {
      bloom: { strength: 0.22, radius: 0.4 },
      lens: { aberration: 0.006, streak: 0.1, grain: 0.02 },
      // Painted to be seen as the prototype was, through a CSS mask over the page.
      fadeSpace: "display",
      feather: { sides: 0.1, top: 0.06, bottom: 0.32 },
    },
    toonSea,
  );
}
