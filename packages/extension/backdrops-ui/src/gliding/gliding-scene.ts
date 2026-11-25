/**
 * The Gliding backdrop: a vast 3-layer painterly gouache turquoise-to-marine ocean
 * with organic seafloor dapples, wave-edge anime sheen, sea gleam, altitude-coupled
 * painterly shadows, living gliding seagulls, moving control surfaces on `WB-027`,
 * corner-riding rim sheen, wingtip wind trails, and minimalist endurance HUD.
 */
import { SPEED_KNOB } from "@kb/backdrops";
import { knobValue } from "@kb/model";
import type { SceneStage } from "@kb/scene-gpu";
import {
  groundsOf,
  mountBackdrop,
  type BackdropLayout,
  type BackdropParts,
  type GpuBackdropInit,
  type GpuBackdropScene,
  type GpuLook,
} from "../gpu/gpu-scene.ts";
import { HEAD_HEIGHT } from "../gpu/head";
import type { Reactions } from "../scene/reactions";
import { variation } from "../scene/seed";
import { createAircraftRig } from "./aircraft-rig";
import { createEnduranceHud } from "./endurance-hud";
import { glidingUniforms, oceanFrame } from "./gliding-shader";
import {
  GLIDING_STILL,
  glidingTuning,
  stepGlidingMotion,
  type GlidingMotion,
  type GlidingTuning,
} from "./gliding-tuning";
import { createOceanWaveUniforms, type OceanWaveUniforms } from "./ocean-wave";
import { createPainterlyUniforms, painterlyFinish, type PainterlyUniforms } from "./painterly-post";
import { createSeagullFlock } from "./seagulls";
import { createWindTrails } from "./wind-trails";

const CAMERA_FOV = 40;
const CAMERA_Z = 10;

function syncWaveUniforms(
  wave: OceanWaveUniforms,
  motion: GlidingMotion,
  parallax: number,
  speedFactor: number,
): void {
  wave.scroll.value = motion.scroll;
  wave.swellPhase.value = motion.swellPhase;
  wave.parallax.value = parallax;
  wave.speed.value = speedFactor;
  wave.dolly.value.set(motion.dollyX, motion.dollyY);
}

function createGlidingStage(stage: SceneStage, init: GpuBackdropInit) {
  const vary = variation(init.seed);
  const u = glidingUniforms();
  const wave = createOceanWaveUniforms();
  const grounds = groundsOf(stage);
  const originX = init.reducedMotion ? 1.85 : vary.range("ocean.x", -6, 6);
  const originY = init.reducedMotion ? 0.92 : vary.range("ocean.y", -6, 6);
  u.origin.value.set(originX, originY);
  wave.origin.value.set(originX, originY);
  u.seedWarmth.value = init.reducedMotion ? 0 : vary.range("ocean.warmth", -0.14, 0.14);

  stage.camera.position.set(0, 0, CAMERA_Z);
  stage.camera.lookAt(0, 0, 0);
  stage.scene.backgroundNode = oceanFrame(u, grounds);

  const aircraft = createAircraftRig(grounds, wave);
  const windTrails = createWindTrails(grounds);
  aircraft.hull.add(windTrails.group);
  const flock = createSeagullFlock(grounds, wave);
  const hud = createEnduranceHud(grounds);
  stage.scene.add(aircraft.castShadow, flock.shadows, flock.birds, aircraft.group, hud.group);
  return { u, wave, aircraft, windTrails, flock, hud };
}

type GlidingStage = ReturnType<typeof createGlidingStage>;

function applyGlidingLook(
  st: GlidingStage,
  painterly: PainterlyUniforms,
  look: GpuLook,
  tuned: GlidingTuning,
): void {
  st.u.dark.value = look.dark ? 1 : 0;
  st.u.sunWarmth.value = tuned.sunWarmth;
  st.u.foam.value = tuned.foam;
  st.u.caustics.value = tuned.caustics;
  st.u.parallax.value = tuned.parallax;
  st.u.waveSheen.value = tuned.waveSheen;
  st.u.seaGleam.value = tuned.seaGleam;
  painterly.brush.value = tuned.painterly;
  painterly.paper.value = tuned.paperTexture;
  painterly.dark.value = look.dark ? 1 : 0;
  painterly.sunWarmth.value = tuned.sunWarmth;
  st.aircraft.setLook({
    dark: look.dark,
    sunWarmth: tuned.sunWarmth,
    parallax: tuned.parallax,
    shadowBlend: tuned.shadowBlend,
    shadowDepth: tuned.shadowDepth,
    shadowSoftness: tuned.shadowSoftness,
    shadowSize: tuned.shadowSize,
    shadowAltitude: tuned.shadowAltitude,
    hullShadow: tuned.hullShadow,
    hullSheen: tuned.hullSheen,
  });
  st.flock.setLook({
    dark: look.dark,
    sunWarmth: tuned.sunWarmth,
    parallax: tuned.parallax,
    shadowBlend: tuned.shadowBlend,
    shadowDepth: tuned.shadowDepth,
    shadowSoftness: tuned.shadowSoftness,
    shadowSize: tuned.shadowSize,
    shadowAltitude: tuned.shadowAltitude,
    birdsAmount: tuned.birds,
  });
  st.windTrails.setLook({ dark: look.dark, gain: tuned.windTrails });
  st.hud.setLook({ dark: look.dark });
}

function gliding(
  stage: SceneStage,
  init: GpuBackdropInit,
  painterly: PainterlyUniforms,
): BackdropParts {
  const st = createGlidingStage(stage, init);
  const { u, wave, aircraft, windTrails, flock, hud } = st;

  let tuned: GlidingTuning = glidingTuning(init.knobs);
  let speedFactor = knobValue(init.knobs, SPEED_KNOB);
  let motion: GlidingMotion = GLIDING_STILL;
  let width = 1;
  let height = 1;

  return {
    panel: { x: 0.24, y: 0.44, scale: 0.62, presence: 0.94 },
    wide: { x: 0.46, y: 0.46, scale: 0.88, presence: 1 },
    ready: aircraft.ready,
    layout: (layout: BackdropLayout) => {
      width = layout.width;
      height = layout.height;
      const aspect = width / Math.max(1, height);
      u.aspect.value = aspect;
      u.anchor.value.set(layout.anchor.x, layout.anchor.y);
      wave.anchor.value.set(layout.anchor.x, layout.anchor.y);
      painterly.aspect.value = aspect;
      painterly.texel.value.set(1 / Math.max(1, width), 1 / Math.max(1, height));
      u.scrim.layout(layout);
      const isStudio = height > HEAD_HEIGHT * 1.25;
      u.bottomDissolve.value = isStudio ? 0 : 1;
      const sharedLayout = {
        anchorX: isStudio ? layout.anchor.x - 0.24 : layout.anchor.x,
        anchorY: isStudio ? layout.anchor.y + 0.07 : layout.anchor.y,
        scale: isStudio ? layout.anchor.scale * 0.98 : layout.anchor.scale,
        aspect,
        fovDeg: CAMERA_FOV,
        cameraZ: CAMERA_Z,
      };
      aircraft.setLayout(sharedLayout);
      flock.setLayout(sharedLayout);
      hud.setLayout({ ...sharedLayout, isStudio, width, height });
      return layout.anchor;
    },
    setLook: (look: GpuLook) => {
      tuned = glidingTuning(look.knobs);
      speedFactor = knobValue(look.knobs, SPEED_KNOB);
      applyGlidingLook(st, painterly, look, tuned);
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
        seabedMotion: tuned.seabedMotion,
        swellMotion: tuned.swellMotion,
        foamMotion: tuned.foamMotion,
      });
      u.scroll.value = motion.scroll;
      u.seabedPhase.value = motion.seabedPhase;
      u.swellPhase.value = motion.swellPhase;
      u.foamPhase.value = motion.foamPhase;
      u.dolly.value.set(motion.dollyX, motion.dollyY);
      syncWaveUniforms(wave, motion, tuned.parallax, speedFactor);

      const reducedMotion = stage.reduced();
      aircraft.update({
        dt,
        time: motion.time,
        calm: reactions.calm,
        pointerOffsetX: offsetX,
        pointerOffsetY: offsetY,
        pointerNear: pointer.near,
        dollyX: motion.dollyX,
        dollyY: motion.dollyY,
        speedFactor,
        reducedMotion,
      });
      const flight = aircraft.flightState();
      windTrails.update({
        time: motion.time,
        bankRoll: flight.bankRoll,
        bankPitch: flight.bankPitch,
        speedFactor,
        reducedMotion,
      });
      flock.update({
        time: motion.time,
        dollyX: motion.dollyX,
        dollyY: motion.dollyY,
        reducedMotion,
      });
      hud.update({
        time: motion.time,
        dollyX: motion.dollyX,
        dollyY: motion.dollyY,
        reducedMotion,
      });
    },
    dispose: () => {
      aircraft.dispose();
      windTrails.dispose();
      flock.dispose();
      hud.dispose();
    },
  };
}

export function mountGliding(host: HTMLElement, init: GpuBackdropInit): Promise<GpuBackdropScene> {
  const painterly = createPainterlyUniforms();
  return mountBackdrop(
    host,
    init,
    {
      projection: { kind: "perspective", fov: CAMERA_FOV },
      bloom: { strength: 0, radius: 0.4 },
      lens: { aberration: 0, streak: 0, grain: 0.01 },
      fadeSpace: "display",
      feather: { sides: 0, top: 0.03, bottom: 0.05 },
      finish: painterlyFinish(painterly),
    },
    (stage, mountedInit) => gliding(stage, mountedInit, painterly),
  );
}
