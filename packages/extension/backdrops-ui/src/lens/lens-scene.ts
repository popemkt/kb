/**
 * The Lens backdrop: a dark star drifting through a nebula and bending its
 * light (shaders: `lens-shader.ts`). Every mount draws its own nebula from
 * its seed, within curated ranges: one of five palettes, its structure, its
 * star density, where the star rests. The nebula turns and evolves over
 * minutes.
 *
 * The owner: the star follows the pointer on a critically damped spring
 * (M1), and with no pointer it circles where it rests; typing calms it,
 * barely (its pull eases by a tenth, so the nebula hardly shifts). Writes are
 * an impulse, never a restart: each keystroke swells the star's mass a
 * little, so typing is a gentle sustained pulse; a write outside typing
 * lights a supernova just beside it, lensed into two images, which a further
 * write brightens rather than starts again.
 */
import { offscreenPass, type SceneStage } from "@kb/scene-gpu";
import type { Reactions } from "../scene/reactions";
import { variation } from "../scene/seed";
import {
  mountBackdrop,
  type BackdropLayout,
  type BackdropParts,
  type GpuBackdropInit,
  type GpuBackdropScene,
  type GpuLook,
  groundsOf,
} from "../gpu/gpu-scene";
import { lensFrame, lensUniforms, nebulaFragment } from "./lens-shader";

/** Curated palettes: [gas core, gas rim, filament], linear. */
type Palette = readonly (readonly [number, number, number])[];
const PALETTES: readonly [Palette, ...Palette[]] = [
  [
    [0.55, 0.32, 1.0],
    [0.1, 0.55, 1.0],
    [1.0, 0.55, 0.35],
  ],
  [
    [1.0, 0.36, 0.22],
    [0.75, 0.18, 0.55],
    [1.0, 0.82, 0.5],
  ],
  [
    [0.2, 0.85, 0.85],
    [0.25, 0.3, 1.0],
    [0.95, 0.6, 1.0],
  ],
  [
    [0.95, 0.65, 0.3],
    [0.35, 0.45, 1.0],
    [1.0, 0.9, 0.7],
  ],
  [
    [0.85, 0.3, 0.75],
    [0.2, 0.6, 0.95],
    [0.6, 1.0, 0.85],
  ],
];

/** How far past the frame the nebula is drawn: the lens reads up to ~2.4 θE away. */
const MARGIN = 0.4;
/** The star's critically damped spring (ω, rad/s): it follows in about 0.6 s. */
const FOLLOW = 9;
/** Below this the supernova is dark, and the next one may light elsewhere (just off the star's line of sight, so both images and the arc show). */
const FLASH_REST = 0.03;
/** The nebula is redrawn this often (s): it changes over minutes, so a few times a second is smooth. */
const NEBULA_EVERY = 0.12;

function lens(stage: SceneStage, init: GpuBackdropInit): BackdropParts {
  const vary = variation(init.seed);
  const palette = vary.pick("palette", PALETTES);
  const u = lensUniforms();
  const [core, rim, filament] = palette;
  if (core !== undefined) u.core.value.setRGB(...core);
  if (rim !== undefined) u.rim.value.setRGB(...rim);
  if (filament !== undefined) u.filament.value.setRGB(...filament);
  u.offset.value.set(vary.range("nebula.x", 0, 100), vary.range("nebula.y", 0, 100));
  u.spin.value = vary.sign("spin") * vary.range("spin.rate", 0.0012, 0.002); // ~4–7° a minute
  u.warp.value = vary.range("warp", 3, 4.5);
  u.density.value = vary.range("density", 0.92, 1.04);
  u.starCut.value = vary.range("stars", 0.93, 0.96);
  /** Where the star rests, as shares of the composition's reach (`layout`). */
  const rest = { x: vary.range("rest.x", -0.35, 0.35), y: vary.range("rest.y", -0.3, 0.3) };
  u.time.value = vary.range("clock", 0, 400);

  const nebula = offscreenPass(stage.renderer, () => nebulaFragment(u), { history: false });
  stage.scene.backgroundNode = lensFrame(u, nebula.picture, groundsOf(stage));

  let width = 1;
  let height = 1;
  let scale = 1;
  const home = { x: 0, y: 0 };
  const position = { x: 0, y: 0 };
  const velocity = { x: 0, y: 0 };
  let orbit = 0;
  let sinceNebula = Infinity;
  let settled = false;

  return {
    // In a panel the star rests high and right, small and quiet; wide, right of the title.
    panel: { x: 0.28, y: 0.22, scale: 0.7, presence: 0.55 },
    wide: { x: 0.32, y: 0.36, scale: 1, presence: 1 },
    layout: ({ width: w, height: h, quality, anchor }: BackdropLayout) => {
      width = w;
      height = h;
      scale = anchor.scale;
      const aspect = w / h;
      home.x = anchor.x + rest.x * 0.12 * scale;
      home.y = anchor.y + rest.y * 0.1 * scale;
      u.cloud.value.set(home.x + 0.1 * scale, home.y - 0.05 * scale);
      if (!settled) {
        position.x = home.x;
        position.y = home.y;
        settled = true;
      }
      const reach = aspect / 2 + MARGIN;
      u.window.value.set(-reach, -0.5 - MARGIN, reach, 0.5 + MARGIN);
      // The nebula is soft: at full quality a texel is about 2 CSS pixels.
      const texel = 0.3 + 0.25 * quality;
      nebula.setSize((w + 2 * MARGIN * h) * texel, (h + 2 * MARGIN * h) * texel);
      sinceNebula = Infinity;
    },
    setLook: (look: GpuLook) => {
      u.dark.value = look.dark ? 1 : 0;
      stage.setBloom(look.dark ? 0.32 : 0);
      sinceNebula = Infinity;
    },
    frame: (dt: number, reactions: Reactions) => {
      u.time.value += dt;
      orbit += dt;
      const pointer = reactions.pointer;
      const aim =
        pointer.near > 0.05
          ? { x: (pointer.x - width / 2) / height, y: (height / 2 - pointer.y) / height }
          : {
              x: home.x + 0.12 * scale * Math.cos(orbit * 0.16),
              y: home.y + 0.06 * scale * Math.sin(orbit * 0.16),
            };
      if (dt > 0) {
        velocity.x += (FOLLOW * FOLLOW * (aim.x - position.x) - 2 * FOLLOW * velocity.x) * dt;
        velocity.y += (FOLLOW * FOLLOW * (aim.y - position.y) - 2 * FOLLOW * velocity.y) * dt;
        position.x += velocity.x * dt;
        position.y += velocity.y * dt;
      }
      u.lens.value.set(position.x, position.y);
      u.einstein.value = 0.15 * scale;
      // Typing calms the star, barely; the owner's writes swell it.
      u.mass.value = (1 - 0.1 * reactions.calm) * (1 + 0.15 * reactions.impulse);
      // A supernova lights where the star is when one starts from dark, and is then carried on.
      if (u.flash.value < FLASH_REST && reactions.stir >= FLASH_REST) {
        u.supernova.value.set(position.x + 0.03 * scale, position.y + 0.015 * scale);
      }
      u.flash.value = reactions.stir;
      sinceNebula += dt;
      if (sinceNebula >= NEBULA_EVERY) {
        nebula.render();
        sinceNebula = 0;
      }
    },
    dispose: nebula.dispose,
  };
}

export function mountLens(host: HTMLElement, init: GpuBackdropInit): Promise<GpuBackdropScene> {
  return mountBackdrop(
    host,
    init,
    {
      bloom: { strength: 0.32, radius: 0.55 },
      lens: { aberration: 0.012, streak: 0, grain: 0.03 },
    },
    lens,
  );
}
