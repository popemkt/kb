/**
 * The Prism ribbon backdrop: a glossy, iridescent 3D twisted ribbon drifting
 * across a dissolving midnight-navy and warm-plum field, traced with glowing
 * blueprint grids and curvature-projected shader code.
 *
 * - **Width-agnostic.** Composed from height and content anchor (`data-hero`):
 *   widening the window extends the ribbon and atmospheric field smoothly
 *   without shifting or rescaling the central crest.
 * - **Two layers.** Only the atmospheric field dissolves into the page via
 *   `gpu/dissolve.ts`; the 3D ribbon floats whole and unclipped above it with
 *   a contact shadow and luminous rim halo.
 * - **Motion & interaction.** Slow, multi-frequency undulation that pauses on
 *   the curated still pose under reduced motion; bounded, frame-rate
 *   independent fast-attack / slow-release pointer reaction steers the light
 *   and reveals nearby shader code.
 */
import type { Matrix3 } from "three/webgpu";
import type { SceneStage } from "@kb/scene-gpu";
import type { Reactions } from "../scene/reactions";
import { hueTurn } from "../scene/seed";
import {
  groundsOf,
  mountBackdrop,
  type BackdropLayout,
  type BackdropParts,
  type GpuBackdropInit,
  type GpuBackdropScene,
  type GpuLook,
} from "../gpu/gpu-scene";
import { textScrim } from "../gpu/text-scrim";
import {
  prismRibbonTuning,
  prismRibbonVariation,
  ribbonFieldReach,
  stepPointerRig,
  type PointerRig,
} from "./prism-ribbon";
import { prismRibbonFrame, prismRibbonUniforms } from "./prism-ribbon-shader";
import { createSdfFontResources } from "./sdf-font";

/** Base 3D ribbon tilt matching the sweeping diagonal crest-to-belly angle. */
const BASE_TILT_X = -0.0395;
const BASE_TILT_Y = 0.0819;
const MAX_STEPS = 28;
const MIN_STEPS = 18;

function setModelRotation(
  rotMat: Matrix3,
  invMat: Matrix3,
  rx: number,
  ry: number,
  rz: number,
): void {
  const cx = Math.cos(rx);
  const sx = Math.sin(rx);
  const cy = Math.cos(ry);
  const sy = Math.sin(ry);
  const cz = Math.cos(rz);
  const sz = Math.sin(rz);
  // Build row-major args for Three's Matrix3.set: R = Rx * Ry * Rz
  const r00 = cy * cz;
  const r01 = -cy * sz;
  const r02 = sy;
  const r10 = sx * sy * cz + cx * sz;
  const r11 = -sx * sy * sz + cx * cz;
  const r12 = -sx * cy;
  const r20 = -cx * sy * cz + sx * sz;
  const r21 = cx * sy * sz + sx * cz;
  const r22 = cx * cy;
  rotMat.set(r00, r01, r02, r10, r11, r12, r20, r21, r22);
  invMat.copy(rotMat).transpose();
}

function prismRibbon(stage: SceneStage, init: GpuBackdropInit): BackdropParts {
  const vary = prismRibbonVariation(init.seed, init.reducedMotion);
  const fonts = createSdfFontResources();
  const scrim = textScrim();
  const u = prismRibbonUniforms();
  u.codeLen.value = fonts.codeLength;
  u.fieldPhase.value = vary.fieldPhase;
  stage.scene.backgroundNode = prismRibbonFrame(u, fonts, scrim, groundsOf(stage));

  let width = 1;
  let height = 1;
  let flow = vary.flowStart;
  let maskTime = vary.maskStart;
  let pointerRig: PointerRig = { x: 0, y: 0, near: 0 };

  const applyTilt = (px: number, py: number) => {
    setModelRotation(
      u.modelRot.value,
      u.invModelRot.value,
      BASE_TILT_X + vary.tiltX + py * 0.45,
      BASE_TILT_Y + vary.tiltY - px * 0.55,
      px * 0.14,
    );
  };
  applyTilt(0, 0);

  return {
    // Panel: slightly compact and gently lifted so the title reads clearly.
    // Wide: full edge-to-edge sweeping composition anchored to content centre.
    panel: { x: 0.04, y: 0.46, scale: 0.72, presence: 0.94 },
    wide: { x: 0, y: 0.5, scale: 1, presence: 1 },
    layout: (layout: BackdropLayout) => {
      width = layout.width;
      height = layout.height;
      const aspect = width / Math.max(1, height);
      u.hero.value.set(layout.anchor.x, layout.anchor.y, layout.anchor.scale);
      u.steps.value = Math.round(MIN_STEPS + (MAX_STEPS - MIN_STEPS) * layout.quality);
      u.reach.set(ribbonFieldReach(aspect, layout.anchor));
      scrim.layout(layout);
      return layout.anchor;
    },
    setLook: (look: GpuLook) => {
      const tuned = prismRibbonTuning(look.knobs);
      u.dark.value = look.dark ? 1 : 0;
      u.codeGain.value = tuned.code;
      u.prismGain.value = tuned.prism;
      u.turn.value.set(...hueTurn(vary.hue + tuned.hue));
      stage.setBloom(look.dark ? 0.28 : 0);
    },
    frame: (dt: number, reactions: Reactions) => {
      const pace = 1 - reactions.calm * 0.55;
      // Gentle, contemplative motion so the ribbon breathes without distracting from content.
      flow += dt * 0.14 * pace;
      maskTime += dt * 0.22 * pace;
      u.flow.value = flow;
      u.time.value = maskTime;
      u.impulse.value = reactions.impulse;

      const ptr = reactions.pointer;
      const overX = (ptr.x - width / 2) / Math.max(1, height);
      const overY = (height / 2 - ptr.y) / Math.max(1, height);
      pointerRig = stepPointerRig(pointerRig, { x: overX, y: overY, near: ptr.near }, dt);
      u.pointer.value.set(pointerRig.x, pointerRig.y, pointerRig.near);
      u.cursor.value.set(overX, overY);
      applyTilt(pointerRig.x, pointerRig.y);
    },
    dispose: () => {
      fonts.dispose();
    },
  };
}

export function mountPrismRibbon(
  host: HTMLElement,
  init: GpuBackdropInit,
): Promise<GpuBackdropScene> {
  return mountBackdrop(
    host,
    init,
    {
      bloom: { strength: 0.28, radius: 0.56 },
      lens: { aberration: 0, streak: 0, grain: 0.028 },
      fadeSpace: "display",
      feather: { sides: 0, top: 0.03, bottom: 0.04 },
    },
    prismRibbon,
  );
}
