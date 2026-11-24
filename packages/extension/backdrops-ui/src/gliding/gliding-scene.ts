/**
 * The Gliding backdrop (Step 1 — Painterly Gouache Ocean): an infinite
 * world-space turquoise-to-marine gouache ocean gliding steadily toward the
 * lower-left beneath an aerial view, dissolving organically into both dark
 * and light pages.
 *
 * - Width-agnostic: world coordinates derive strictly from frame height and
 *   the content-anchored hero position (`anchor`), so widening 1280px → 2560px
 *   reveals more open ocean smoothly without stretching or shifting the hero.
 * - Calm gliding motion: scrolls steadily toward lower-left with subtle 0.18×
 *   organic phase drift; holds a curated picturesque still under reduced motion.
 * - Pointer interaction: applies a restrained, critically-eased camera dolly
 *   lean with zero cursor spotlight; typing gently slows the glide.
 */
import type { SceneStage } from "@kb/scene-gpu";
import { reachWithin } from "../gpu/dissolve";
import {
  groundsOf,
  mountBackdrop,
  type BackdropLayout,
  type BackdropParts,
  type GpuBackdropInit,
  type GpuBackdropScene,
  type GpuLook,
} from "../gpu/gpu-scene.ts";
import type { Reactions } from "../scene/reactions";
import { variation } from "../scene/seed";
import { glidingUniforms, oceanFrame } from "./gliding-shader";
import {
  GLIDING_STILL,
  glidingTuning,
  stepGlidingMotion,
  type GlidingMotion,
} from "./gliding-tuning";

function gliding(stage: SceneStage, init: GpuBackdropInit): BackdropParts {
  const vary = variation(init.seed);
  const u = glidingUniforms();

  // Curated still origin for reduced motion; seeded open-ocean stretch on live loads.
  const originX = init.reducedMotion ? 1.85 : vary.range("ocean.x", -6, 6);
  const originY = init.reducedMotion ? 0.92 : vary.range("ocean.y", -6, 6);
  u.origin.value.set(originX, originY);
  u.seedWarmth.value = init.reducedMotion ? 0 : vary.range("ocean.warmth", -0.14, 0.14);

  stage.scene.backgroundNode = oceanFrame(u, groundsOf(stage));

  let motion: GlidingMotion = GLIDING_STILL;
  let width = 1;
  let height = 1;

  return {
    // Anchored slightly right of content center for Step 2's glider hero, calmer in narrow panels.
    panel: { x: 0.18, y: 0.48, scale: 0.72, presence: 0.94 },
    wide: { x: 0.36, y: 0.48, scale: 1, presence: 1 },
    layout: (layout: BackdropLayout) => {
      width = layout.width;
      height = layout.height;
      const aspect = width / Math.max(1, height);
      u.aspect.value = aspect;
      u.anchor.value.set(layout.anchor.x, layout.anchor.y);
      u.scrim.layout(layout);
      // Organic superellipse reach clearing all frame borders on desktop, ultra-wide and mobile.
      u.reach.set(
        reachWithin(
          aspect,
          { x: 0, y: 0 },
          { x: Math.max(0.46, aspect * 0.49), y: 0.46 },
          aspect < 1.5 ? 0.44 : 0.56,
        ),
      );
      return layout.anchor;
    },
    setLook: (look: GpuLook) => {
      const tuned = glidingTuning(look.knobs);
      u.dark.value = look.dark ? 1 : 0;
      u.sunWarmth.value = tuned.sunWarmth;
      u.foam.value = tuned.foam;
      stage.setBloom(0);
    },
    frame: (dt: number, reactions: Reactions) => {
      const pointer = reactions.pointer;
      const offsetX = width > 0 ? ((pointer.x - width / 2) / Math.max(1, height)) * 0.9 : 0;
      const offsetY = height > 0 ? ((height / 2 - pointer.y) / Math.max(1, height)) * 1.4 : 0;
      motion = stepGlidingMotion(motion, {
        dt,
        calm: reactions.calm,
        pointerNear: pointer.near,
        pointerOffsetX: offsetX,
        pointerOffsetY: offsetY,
      });
      u.scroll.value = motion.scroll;
      u.phase.value = motion.phase;
      u.dolly.value.set(motion.dollyX, motion.dollyY);
    },
    dispose: () => undefined,
  };
}

export function mountGliding(host: HTMLElement, init: GpuBackdropInit): Promise<GpuBackdropScene> {
  return mountBackdrop(
    host,
    init,
    {
      bloom: { strength: 0, radius: 0.4 },
      // Subtle matte tactile grain strictly on artwork (zero on page ground).
      lens: { aberration: 0, streak: 0, grain: 0.018 },
      fadeSpace: "display",
      // Ground-only dissolve (`gpu/dissolve.ts`) shapes the organic edge; frame feather is only a soft guard.
      feather: { sides: 0.05, top: 0.04, bottom: 0.1 },
    },
    gliding,
  );
}
