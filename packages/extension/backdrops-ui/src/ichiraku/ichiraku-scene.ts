/**
 * The Ichiraku Konoha cyber-ramen 3D backdrop, mounted on kb's canonical GPU
 * backdrop host (`mountBackdrop`, `../gpu/gpu-scene.ts`) with kb's canonical
 * `textScrim()` (`../gpu/text-scrim.ts`).
 *
 * Uses a **symmetric camera projection** (translating camera & target laterally
 * from `layout.anchor` instead of `setViewOffset` shear) so Three.js's planar
 * `reflector()` virtual camera aligns to the exact pixel in both WebGPU and
 * WebGL2, with zero camera-attached overlay quads that could ghost into the
 * reflection pass.
 */
import {
  type BufferGeometry,
  Group,
  InstancedMesh,
  LineSegments,
  type Material,
  Mesh,
  Object3D,
  PlaneGeometry,
  Vector3,
} from "three/webgpu";
import { reflector, uniform } from "three/tsl";
import { ICHIRAKU_INK_KNOB, ICHIRAKU_NEON_KNOB, ICHIRAKU_RAIN_KNOB } from "@kb/backdrops";
import { knobValue } from "@kb/model";
import type { SceneStage } from "@kb/scene-gpu";
import type { Reactions } from "../scene/reactions";
import type { Rng } from "../scene/rng";
import { variation } from "../scene/seed";
import type { Anchor, Composition } from "../gpu/framing";
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
import { loadBlenderStage } from "./blender-stage";
import { buildLiveElements } from "./live-elements";
import {
  rainStreakMaterial,
  reflectorSampleUv,
  wetAsphaltMaterial,
  type IchirakuUniforms,
} from "./shaders";
import { createIchirakuTextures } from "./textures";

const STILL_TIME = 4.2;
const RAIN_COUNT = 260;

/**
 * Shift the hero diorama right of kb's left-aligned page title column so the
 * dim shuttered Konoha shop sits behind `"Sun, Nov 22"` and the glowing
 * Ichiraku stall + delivery bike + charger shine cleanly to its right.
 */
const PANEL: Composition = { x: 0.24, y: 0.46, scale: 0.85, presence: 0.85 };
const WIDE: Composition = { x: 0.28, y: 0.5, scale: 1.0, presence: 1.0 };

interface RainDrop {
  x: number;
  y: number;
  z: number;
  speed: number;
  len: number;
  width: number;
}

function makeRainDrops(rng: Rng): RainDrop[] {
  return Array.from({ length: RAIN_COUNT }, (_, idx) => {
    const layer = idx % 3;
    const z =
      layer === 0
        ? 1.5 + rng.next() * 3.8
        : layer === 1
          ? -2.2 + rng.next() * 3.7
          : -6.8 + rng.next() * 4.5;
    const speed =
      layer === 0
        ? 8.2 + rng.next() * 3.2
        : layer === 1
          ? 6.4 + rng.next() * 2.8
          : 4.8 + rng.next() * 2.2;
    const len =
      layer === 0
        ? 0.55 + rng.next() * 0.4
        : layer === 1
          ? 0.38 + rng.next() * 0.3
          : 0.26 + rng.next() * 0.2;
    const width = layer === 0 ? 1.3 : layer === 1 ? 1.0 : 0.7;
    return {
      x: (rng.next() - 0.5) * 23.0,
      y: rng.next() * 6.8,
      z,
      speed,
      len,
      width,
    };
  });
}

function buildRainField(
  shared: IchirakuUniforms,
  rng: Rng,
): {
  readonly mesh: InstancedMesh;
  readonly step: (dt: number) => void;
} {
  const drops = makeRainDrops(rng);
  const mesh = new InstancedMesh(
    new PlaneGeometry(0.011, 1.0),
    rainStreakMaterial(shared),
    RAIN_COUNT,
  );
  const dummy = new Object3D();
  const step = (dt: number) => {
    for (let i = 0; i < drops.length; i++) {
      const d = drops[i];
      if (d === undefined) continue;
      d.y -= d.speed * dt;
      d.x -= d.speed * dt * 0.16;
      if (d.y < -0.2) {
        d.y += 7.0;
        d.x = ((((d.x + 11.5) % 23.0) + 23.0) % 23.0) - 11.5;
      }
      dummy.position.set(d.x, d.y, d.z);
      dummy.rotation.set(0, 0, -0.16);
      dummy.scale.set(d.width, d.len, 1);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  };
  step(0);
  return { mesh, step };
}

function disposeSubtree(root: Object3D): void {
  const geometries = new Set<BufferGeometry>();
  const materials = new Set<Material>();
  root.traverse((obj) => {
    if (obj instanceof Mesh || obj instanceof LineSegments) {
      geometries.add(obj.geometry);
      if (Array.isArray(obj.material)) {
        for (const m of obj.material) materials.add(m);
      } else {
        materials.add(obj.material);
      }
    }
  });
  for (const geo of geometries) geo.dispose();
  for (const mat of materials) mat.dispose();
}

function buildWetStreet(shared: IchirakuUniforms, stage: SceneStage): Mesh {
  // Canonical Three.js planar reflector: preserves `screenUV.flipX()` + ripple normal warp,
  // with `bounces: false` so WebGPU & WebGL2 never recurse on the floor pass.
  const reflection = reflector({ resolutionScale: 0.62, bounces: false });
  reflection.uvNode = reflectorSampleUv(shared);
  reflection.target.rotateX(-Math.PI / 2);
  stage.scene.add(reflection.target);

  const streetMat = wetAsphaltMaterial(shared, reflection.rgb);
  const street = new Mesh(new PlaneGeometry(36, 22), streetMat);
  street.rotation.x = -Math.PI / 2;
  street.position.set(0, 0, -2.5);
  stage.scene.add(street);
  return street;
}

function createSharedUniforms(
  stage: SceneStage,
  init: GpuBackdropInit,
  scrim: ReturnType<typeof textScrim>,
  brushTex: ReturnType<typeof createIchirakuTextures>["brush"],
  initialTime: number,
): IchirakuUniforms {
  const { page, paint } = groundsOf(stage);
  return {
    time: uniform(initialTime),
    writePulse: uniform(0),
    navFlicker: uniform(0),
    dayLift: uniform(init.dark ? 0 : 1),
    rainAmount: uniform(knobValue(init.knobs, ICHIRAKU_RAIN_KNOB)),
    neonAmount: uniform(knobValue(init.knobs, ICHIRAKU_NEON_KNOB)),
    inkAmount: uniform(knobValue(init.knobs, ICHIRAKU_INK_KNOB)),
    page,
    paint,
    textUnder: scrim.under,
    brushTex,
  };
}

function ichirakuParts(stage: SceneStage, init: GpuBackdropInit): BackdropParts {
  const vary = variation(init.seed);
  const initialTime = STILL_TIME + vary.range("phase", -3.0, 3.0);
  const textures = createIchirakuTextures();
  const scrim = textScrim();
  const shared = createSharedUniforms(stage, init, scrim, textures.brush, initialTime);
  const { time, writePulse, navFlicker, dayLift, rainAmount, neonAmount, inkAmount } = shared;

  stage.backdrop({ focus: [0.42, 0.58], warmth: 0.36, haze: 0.78, rise: 0.14, time });
  const fogRange = stage.atmosphere(7.5, 24.0);
  fogRange.amount.value = init.dark ? 0.82 : 0.18;

  const baseCamPos = new Vector3(0.18, 1.48, 7.95);
  const baseLookAt = new Vector3(0.05, 1.72, -1.6);

  const blenderGroup = new Group();
  const live = buildLiveElements(shared, textures);
  const rain = buildRainField(shared, vary.stream("rain"));
  stage.scene.add(blenderGroup, live.group, rain.mesh);
  const street = buildWetStreet(shared, stage);
  const blenderStage = loadBlenderStage(blenderGroup, shared, textures);

  let clockSec = initialTime;
  let targetDayLift = init.dark ? 0 : 1;
  let camOffsetX = 0;
  let camOffsetY = 0;
  let hostWidth = 1040;
  let hostHeight = 360;
  let hero: Anchor = { x: 0.28, y: 0, scale: 1 };

  const placeCamera = () => {
    // Translate camera & lookAt laterally instead of `setViewOffset` shear so
    // `ReflectorNode`'s virtual camera matches the main projection to the exact pixel!
    const lateralShift = -hero.x * 4.4;
    const vertShift = -hero.y * 1.4;
    stage.camera.position.set(
      baseCamPos.x + lateralShift + camOffsetX,
      baseCamPos.y + vertShift + camOffsetY,
      baseCamPos.z / Math.max(0.75, hero.scale),
    );
    stage.camera.lookAt(
      baseLookAt.x + lateralShift + camOffsetX * 0.3,
      baseLookAt.y + vertShift + camOffsetY * 0.2,
      baseLookAt.z,
    );
  };
  placeCamera();

  return {
    panel: PANEL,
    wide: WIDE,
    ready: blenderStage.ready,
    frame: (dt: number, reactions: Reactions) => {
      clockSec += dt;
      time.value = clockSec;

      const pulse = Math.min(1, reactions.impulse * 1.4);
      const nav = Math.min(1, reactions.stir * 1.2);
      writePulse.value = pulse;
      navFlicker.value = nav * Math.sin(clockSec * 22) * 0.5 + nav * 0.5;
      // Apply theme transitions immediately when paused (reduced motion or Speed = 0).
      if (dt === 0) {
        dayLift.value = targetDayLift;
      } else {
        dayLift.value += (targetDayLift - dayLift.value) * Math.min(1, dt * 4.5);
      }

      const ptr = reactions.pointer;
      const nx = hostWidth <= 0 ? 0 : (ptr.x / hostWidth - 0.5) * 2 * ptr.near;
      const ny = hostHeight <= 0 ? 0 : (ptr.y / hostHeight - 0.5) * 2 * ptr.near;
      const ease = dt === 0 ? 1 : Math.min(1, dt * 3.5);
      camOffsetX += ((dt === 0 ? 0 : nx * 0.2) - camOffsetX) * ease;
      camOffsetY += ((dt === 0 ? 0 : -ny * 0.06) - camOffsetY) * ease;
      placeCamera();

      live.update(clockSec, pulse, nav);
      if (dt > 0) rain.step(dt);
    },
    layout: (layout: BackdropLayout) => {
      hostWidth = layout.width;
      hostHeight = layout.height;
      hero = layout.anchor;
      scrim.layout(layout);
      placeCamera();
      return hero;
    },
    setLook: (look: GpuLook) => {
      targetDayLift = look.dark ? 0 : 1;
      fogRange.amount.value = look.dark ? 0.82 : 0.18;
      const neon = knobValue(look.knobs, ICHIRAKU_NEON_KNOB);
      rainAmount.value = knobValue(look.knobs, ICHIRAKU_RAIN_KNOB);
      neonAmount.value = neon;
      inkAmount.value = knobValue(look.knobs, ICHIRAKU_INK_KNOB);
      // Zero bloom in overcast rainy-afternoon light mode so `stage.paint()` stays crisp!
      stage.setBloom(look.dark ? 0.28 * neon : 0);
    },
    dispose: () => {
      blenderStage.dispose();
      disposeSubtree(live.group);
      disposeSubtree(rain.mesh);
      disposeSubtree(street);
      textures.dispose();
    },
  };
}

export function mountIchiraku(host: HTMLElement, init: GpuBackdropInit): Promise<GpuBackdropScene> {
  return mountBackdrop(
    host,
    init,
    {
      projection: { kind: "perspective", fov: 38 },
      bloom: { strength: init.dark ? 0.28 : 0, radius: 0.55 },
      lens: { aberration: 0.0009, streak: 0.08, grain: 0.014 },
      // Painted scene: display-space fade into the page ground (no grey shoulder veil on light mode!).
      fadeSpace: "display",
      feather: { sides: 0.04, top: 0.04, bottom: 0.14 },
    },
    ichirakuParts,
  );
}
