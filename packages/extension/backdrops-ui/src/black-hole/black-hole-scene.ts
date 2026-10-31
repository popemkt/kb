/**
 * The Black hole backdrop: a black hole right of the title, a little below
 * the horizon of its own disk, in one of its looks (`LOOKS`), each a variant
 * the page draws for the load (`GpuLook.variant`):
 *
 * - **Gargantua** (`gargantua.ts`): light traced through the Schwarzschild
 *   metric, a thick, streaming gas disk.
 *
 * Every look is seen through one rig (`hole-rig.ts`): the pointer tilts and
 * swings the camera, slowly (a camera move, not a cursor, M1); with no
 * pointer it rests, breathing. Writes are an impulse, never a restart:
 * typing dims the disk a little and each keystroke breathes into it; a
 * write outside typing sets a hot flare orbiting in it, which a further
 * write brightens rather than starts again.
 *
 * One stage holds whichever look is shown: a pin that changes while the
 * page is open swaps the look in place, never the scene.
 */
import type { SceneStage } from "@kb/scene-gpu";
import { variation } from "../scene/seed";
import {
  mountBackdrop,
  type BackdropParts,
  type GpuBackdropInit,
  type GpuBackdropScene,
  type GpuLook,
} from "../gpu/gpu-scene";
import { gargantua } from "./gargantua";
import type { HoleLook, HoleLookBuild } from "./hole-rig";

/** The black hole's looks, by the variant id its declaration gives each (`BLACK_HOLE_BACKDROP`). */
export const BLACK_HOLE_VARIANTS = ["gargantua"] as const;
export type BlackHoleVariant = (typeof BLACK_HOLE_VARIANTS)[number];

const LOOKS: Readonly<Record<BlackHoleVariant, HoleLookBuild>> = { gargantua };

const isBlackHoleVariant = (id: string | null): id is BlackHoleVariant =>
  BLACK_HOLE_VARIANTS.some((variant) => variant === id);

function blackHole(stage: SceneStage, init: GpuBackdropInit): BackdropParts {
  const vary = variation(init.seed);
  const variantOf = (look: GpuLook): BlackHoleVariant =>
    isBlackHoleVariant(look.variant) ? look.variant : vary.pick("variant", BLACK_HOLE_VARIANTS);
  const build = (variant: BlackHoleVariant): HoleLook => LOOKS[variant](stage, init, vary);
  const first = variantOf(init);
  /** The id of the look on the stage. */
  let shown: string = first;
  let look = build(first);

  return {
    panel: { x: 0.21, y: 0.3, scale: 0.62, presence: 0.72 },
    wide: { x: 0.26, y: 0.38, scale: 1, presence: 1 },
    // The stage lays the new look out after a change of look (`mountBackdrop`).
    layout: (layout) => look.layout(layout),
    setLook: (next: GpuLook) => {
      const variant = variantOf(next);
      if (variant !== shown) {
        look.dispose();
        shown = variant;
        look = build(variant);
      }
      look.setLook(next);
    },
    frame: (dt, reactions) => look.frame(dt, reactions),
    dispose: () => look.dispose(),
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
