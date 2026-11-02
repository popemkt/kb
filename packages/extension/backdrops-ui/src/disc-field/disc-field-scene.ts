/**
 * The Disc field backdrop: a vineyard lane painted in overlapping discs,
 * dissolving into the page by its own spray (the picture: `disc-field.ts`;
 * its shaders: `disc-field-shader.ts`). Each load lays the vineyard out
 * anew from its variation.
 *
 * Framing: the lane is seen through the stage's 40° camera, and the whole
 * picture is moved to the hero's anchor by a lens shift (the camera's view
 * offset), so its size comes from the frame's height alone and a wider
 * frame only adds page at the sides. The silhouette is centred on the same
 * anchor.
 *
 * The owner: the camera stands on a dolly that leans toward the pointer
 * on a critically damped spring, so the near masses slide against the far
 * rows; without a pointer it drifts on slow, unrelated swings. A write is
 * a breath of wind through the leaves, eased in and out. Reduced motion is
 * one still.
 */
import type { SceneStage } from "@kb/scene-gpu";
import type { Reactions } from "../scene/reactions";
import { variation } from "../scene/seed";
import {
  groundsOf,
  mountBackdrop,
  type BackdropLayout,
  type BackdropParts,
  type GpuBackdropInit,
  type GpuBackdropScene,
  type GpuLook,
} from "../gpu/gpu-scene";
import type { Anchor } from "../gpu/framing";
import { textScrim } from "../gpu/text-scrim";
import { bakeVineyard } from "./disc-field";
import { discGround, discSprite, discUniforms } from "./disc-field-shader";

/** The discs a full-quality frame draws; a frame over budget draws a fair subset. */
const DISCS = 97_000;
/** The least share of the discs drawn, at the stage's least quality. */
const LEAST_SHARE = 0.55;
/** The dolly's spring (ω, rad/s): a time constant of about half a second. */
const FOLLOW = 2.2;
/** Where the eye stands and what it looks at, in the lane's world units. */
const EYE = [0, 3, 7.2] as const;
const LOOK = [0, -1, -30] as const;
/** How far the dolly travels for a pointer at the frame's edge: across, up, and how far the look swings. */
const TRAVEL = { x: 0.7, y: 0.25, look: 4 } as const;
/** The camera's vertical field of view (the stage's, degrees). */
const FOV = 40;
/** No disc wider than this share of the frame's height. */
const WIDEST = 0.09;
/** The least disc, CSS pixels: the far field stays covered. */
const FLOOR = 0.95;

function discField(stage: SceneStage, init: GpuBackdropInit): BackdropParts {
  const vary = variation(init.seed);
  const cloud = bakeVineyard(vary, DISCS);
  const scrim = textScrim();
  const u = discUniforms();
  const grounds = groundsOf(stage);
  const sprite = discSprite(u, cloud, scrim, grounds);
  stage.scene.add(sprite);
  stage.scene.backgroundNode = discGround(u, grounds);
  u.motion.value = init.reducedMotion ? 0 : 1;

  const camera = stage.camera;
  let time = vary.range("disc.clock", 0, 90);
  const swing = [vary.phase("disc.swing.x"), vary.phase("disc.swing.y")] as const;
  const lean = { x: 0, y: 0 };
  const velocity = { x: 0, y: 0 };
  let hero: Anchor = { x: 0, y: 0, scale: 1 };
  let width = 1;
  let height = 1;

  const place = () => {
    const idle = {
      x: 0.18 * Math.sin(time * 0.25 + swing[0]) + 0.07 * Math.sin(time * 0.11 + swing[1]),
      y: 0.03 * Math.sin(time * 0.31 + swing[1]),
    };
    camera.position.set(
      EYE[0] + lean.x * TRAVEL.x + idle.x * u.motion.value,
      EYE[1] + lean.y * TRAVEL.y + idle.y * u.motion.value,
      EYE[2],
    );
    camera.lookAt(LOOK[0] - lean.x * TRAVEL.look, LOOK[1] + lean.y * TRAVEL.look * 0.4, LOOK[2]);
  };
  place();

  return {
    // In a panel the painting is smaller and high at the right, off the title's rows; wide, a
    // broad vignette right of the title, its spray reaching under it.
    panel: { x: 0.2, y: 0.44, scale: 0.6, presence: 0.92 },
    wide: { x: 0.38, y: 0.53, scale: 1, presence: 1 },
    layout: (layout: BackdropLayout) => {
      width = layout.width;
      height = layout.height;
      hero = layout.anchor;
      // The picture moved to the anchor by a lens shift, sized by the height alone.
      camera.setViewOffset(width, height, -hero.x * height, hero.y * height, width, height);
      camera.zoom = hero.scale;
      camera.updateProjectionMatrix();
      const device = height * stage.renderer.getPixelRatio();
      u.frame.value = device;
      u.pixels.value.set(
        (device * hero.scale) / (2 * Math.tan((FOV * Math.PI) / 360)),
        FLOOR * stage.renderer.getPixelRatio(),
        WIDEST * device,
      );
      u.aspect.value = width / height;
      u.hero.value.set(hero.x, hero.y, hero.scale);
      sprite.count = Math.round(cloud.count * (LEAST_SHARE + (1 - LEAST_SHARE) * layout.quality));
      scrim.layout(layout);
      return hero;
    },
    setLook: (look: GpuLook) => {
      u.dark.value = look.dark ? 1 : 0;
      stage.setBloom(0);
    },
    frame: (dt: number, reactions: Reactions) => {
      time += dt;
      const pointer = reactions.pointer;
      const over = {
        x: Math.max(-1, Math.min(1, ((pointer.x - width / 2) / height - hero.x) * 0.8)),
        y: Math.max(-1, Math.min(1, ((height / 2 - pointer.y) / height - hero.y) * 1.6)),
      };
      if (dt > 0) {
        const aim = { x: over.x * pointer.near, y: over.y * pointer.near };
        velocity.x += (FOLLOW * FOLLOW * (aim.x - lean.x) - 2 * FOLLOW * velocity.x) * dt;
        velocity.y += (FOLLOW * FOLLOW * (aim.y - lean.y) - 2 * FOLLOW * velocity.y) * dt;
        lean.x += velocity.x * dt;
        lean.y += velocity.y * dt;
      }
      place();
      u.time.value = time;
      u.gust.value = reactions.impulse;
    },
    dispose: () => {
      sprite.geometry.dispose();
      sprite.material.dispose();
    },
  };
}

export function mountDiscField(
  host: HTMLElement,
  init: GpuBackdropInit,
): Promise<GpuBackdropScene> {
  return mountBackdrop(
    host,
    init,
    {
      bloom: { strength: 0, radius: 0.5 },
      lens: { aberration: 0, streak: 0, grain: 0.01 },
      // A painted scene: it fades into the page as a CSS mask would, and dissolves by its own
      // discs well inside the frame; the frame's feather is only the last guard.
      fadeSpace: "display",
      feather: { sides: 0, top: 0.03, bottom: 0.03 },
    },
    discField,
  );
}
