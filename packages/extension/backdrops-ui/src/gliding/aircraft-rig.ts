/**
 * The `WB-027` hero aircraft rig, moving control surfaces, corner-riding anime sheen,
 * and altitude-coupled painterly ocean cast shadow (`gliding-scene.ts`, `ocean-wave.ts`).
 */
import {
  abs,
  clamp,
  dot,
  float,
  fract,
  max,
  mix,
  normalView,
  normalWorld,
  positionViewDirection,
  fwidth,
  pow,
  reflect,
  screenUV,
  smoothstep,
  texture,
  uniform,
  uv,
  vec2,
  vec3,
} from "three/tsl";
import {
  DataTexture,
  Group,
  LinearFilter,
  LinearMipmapLinearFilter,
  type Material,
  Mesh,
  MeshBasicNodeMaterial,
  MeshStandardMaterial,
  type Object3D,
  PlaneGeometry,
  RGBAFormat,
  SRGBColorSpace,
  type Texture,
  TextureLoader,
  Vector3,
} from "three/webgpu";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { TslNode } from "@kb/scene-gpu";
import { darkGrade } from "../gpu/dark-grade";
import type { Grounds } from "../gpu/gpu-scene";
import { stepSpring, type ShadowBlendMode } from "./gliding-tuning";
import {
  applyShadowBlending,
  composeShadowBlend,
  painterlyShadowEdge,
  sampleOceanWaveAt,
  shadowBlendIndex,
  type OceanWaveUniforms,
} from "./ocean-wave";
import wb027Url from "./wb027.glb?url&inline";
import shadowUrl from "./wb027-shadow.png?url&inline";

type F = TslNode<"float">;
type V3 = TslNode<"vec3">;

const AIRCRAFT_HEADING_RAD = -0.635;
const AIRCRAFT_Z = 1.38;
const MODEL_UNIT_SCALE = 0.54;
export const BANK_MAX = { roll: 0.16, pitch: 0.095 } as const;
/** Underdamped aerodynamic spring constants: physical wing inertia + buoyant settle at end of hover. */
const BANK_OMEGA_ATTACK = 4.8;
const BANK_OMEGA_RELEASE = 3.7;
const BANK_ZETA = 0.48;
const SLOW_OMEGA = 2.8;
const SLOW_ZETA = 0.6;

const lin = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const rgb = (r: number, g: number, b: number): V3 => vec3(lin(r / 255), lin(g / 255), lin(b / 255));

function makeScalarUniform(v: number) {
  return uniform(v);
}

type ScalarUniform = ReturnType<typeof makeScalarUniform>;

export interface AircraftFlightState {
  readonly bankRoll: number;
  readonly bankPitch: number;
  readonly rollVel: number;
  readonly pitchVel: number;
  /** Gentle yaw carve synced to banking turns (radians). */
  readonly yawDelta: number;
  readonly yawVel: number;
  /** Buoyant altitude oscillation above/below nominal flight level (world units). */
  readonly altitudeDelta: number;
  readonly altVel: number;
  readonly driftX: number;
  readonly driftY: number;
}

/** Curated heroic still pose shown under reduced motion. */
export const AIRCRAFT_STILL: AircraftFlightState = {
  bankRoll: -0.04,
  bankPitch: 0.025,
  rollVel: 0,
  pitchVel: 0,
  yawDelta: 0,
  yawVel: 0,
  altitudeDelta: 0,
  altVel: 0,
  driftX: 0,
  driftY: 0,
};

const clampRange = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/**
 * Step buoyant altitude breathing, heading yaw carve, and inertial underdamped spring
 * pointer banking by `dt` seconds. Exact closed-form spring math preserves frame-rate
 * independence while giving hover moves real aerodynamic inertia and spring settle.
 */
export function stepAircraftFlight(
  state: AircraftFlightState,
  input: {
    readonly dt: number;
    readonly time: number;
    readonly calm: number;
    readonly pointerOffsetX: number;
    readonly pointerOffsetY: number;
    readonly pointerNear: number;
  },
): AircraftFlightState {
  const { dt, time, calm, pointerOffsetX, pointerOffsetY, pointerNear } = input;
  if (dt <= 0) return state;
  const calmFactor = 1 - clampRange(calm, 0, 1) * 0.65;
  const near = clampRange(pointerNear, 0, 1) * calmFactor;

  const idleRoll =
    (Math.sin(time * 0.41 + 0.7) * 0.036 + Math.sin(time * 0.19 + 2.1) * 0.02) * calmFactor;
  const idlePitch =
    (Math.sin(time * 0.33 + 1.4) * 0.02 + Math.cos(time * 0.15 + 0.3) * 0.012) * calmFactor;
  const targetRoll = clampRange(-pointerOffsetX, -1, 1) * BANK_MAX.roll * near + idleRoll;
  const targetPitch = clampRange(pointerOffsetY, -1, 1) * BANK_MAX.pitch * near + idlePitch;
  const bankOmega = near > 0.05 ? BANK_OMEGA_ATTACK : BANK_OMEGA_RELEASE;
  const roll = stepSpring({
    value: state.bankRoll,
    velocity: state.rollVel,
    target: targetRoll,
    omega: bankOmega,
    zeta: BANK_ZETA,
    dt,
  });
  const pitch = stepSpring({
    value: state.bankPitch,
    velocity: state.pitchVel,
    target: targetPitch,
    omega: bankOmega,
    zeta: BANK_ZETA,
    dt,
  });

  // Course heading carves into the bank with inertial follow-through; altitude rides thermals + climb pitch.
  const targetYaw = clampRange(
    -roll.value * 0.5 + Math.sin(time * 0.17 + 0.9) * 0.055 * calmFactor,
    -0.16,
    0.16,
  );
  const targetAlt =
    (Math.sin(time * 0.24 + 0.5) * 0.24 + Math.cos(time * 0.13 + 1.8) * 0.12) * calmFactor +
    pitch.value * 2.3;
  const yaw = stepSpring({
    value: state.yawDelta,
    velocity: state.yawVel,
    target: targetYaw,
    omega: SLOW_OMEGA,
    zeta: SLOW_ZETA,
    dt,
  });
  const alt = stepSpring({
    value: state.altitudeDelta,
    velocity: state.altVel,
    target: targetAlt,
    omega: SLOW_OMEGA,
    zeta: SLOW_ZETA,
    dt,
  });

  return {
    bankRoll: clampRange(roll.value, -BANK_MAX.roll * 1.32, BANK_MAX.roll * 1.32),
    bankPitch: clampRange(pitch.value, -BANK_MAX.pitch * 1.32, BANK_MAX.pitch * 1.32),
    rollVel: roll.velocity,
    pitchVel: pitch.velocity,
    yawDelta: yaw.value,
    yawVel: yaw.velocity,
    altitudeDelta: alt.value,
    altVel: alt.velocity,
    driftX: (Math.sin(time * 0.27 + 0.4) * 0.018 + Math.sin(time * 0.13 + 1.9) * 0.01) * calmFactor,
    driftY:
      (Math.sin(time * 0.35 + 2.2) * 0.015 + Math.cos(time * 0.17 + 0.8) * 0.008) * calmFactor,
  };
}

interface ShadeUniforms {
  readonly dark: ScalarUniform;
  readonly sunWarmth: ScalarUniform;
  readonly aspect: ScalarUniform;
  readonly time: ScalarUniform;
  readonly hullShadow: ScalarUniform;
  readonly hullSheen: ScalarUniform;
  readonly shadowBlend: ScalarUniform;
  readonly shadowDepth: ScalarUniform;
  readonly shadowSoftness: ScalarUniform;
  readonly altitudeFactor: ScalarUniform;
}

interface ShadeOpts {
  readonly metallic: number;
  readonly roughness: number;
  readonly shadowFloor: number;
  readonly planMappedHull: boolean;
}

/** A short brushstroke follows the projected WB-027 contour in the painted hull's plan-view UVs. */
function hullEdgeSheen(time: F, ndl: F, ndv: F): F {
  const plan = uv();
  const x = plan.x.mul(2.08).sub(1.04);
  const span = abs(x);
  const forward = float(0.36).sub(plan.y.mul(1.3));
  // Sweep the two wings at different times. The segment retreats around the tip onto the aft bevel.
  const phase = fract(
    time
      .mul(0.31)
      .add(0.34)
      .add(smoothstep(-0.08, 0.08, x).mul(0.47)),
  );
  const head = phase.mul(1.95).sub(0.26);
  const ribbon = (distance: F, along: F, width: number, length: number) => {
    const aa = fwidth(distance).max(0.0005);
    const core = float(1).sub(smoothstep(width, aa.add(width), abs(distance)));
    return core.mul(float(1).sub(smoothstep(length * 0.52, length, abs(along.sub(head)))));
  };
  // Leading and outer trailing edge stations from the wing planform, in model units.
  const leading = float(0.132).sub(span.sub(0.095).mul(0.146));
  const aft = float(-0.009).sub(float(0.992).sub(span).mul(0.275));
  const wing = max(
    ribbon(forward.sub(leading), span, 0.01, 0.19),
    ribbon(forward.sub(aft), float(2).sub(span), 0.006, 0.19).mul(smoothstep(0.79, 0.84, span)),
  ).mul(smoothstep(0.1, 0.16, span));

  // Intake lip turns into the outer cowl at x = ±0.102. Both sides of the turn share a path length.
  const lip = ribbon(forward.sub(0.196), span.sub(0.028).mul(4), 0.003, 0.085)
    .mul(smoothstep(0.025, 0.035, span))
    .mul(float(1).sub(smoothstep(0.098, 0.105, span)));
  const side = ribbon(
    span.sub(0.101),
    float(0.296).add(float(0.196).sub(forward).mul(4)),
    0.0025,
    0.085,
  )
    .mul(smoothstep(0.055, 0.066, forward))
    .mul(float(1).sub(smoothstep(0.19, 0.198, forward)));
  const catchesLight = smoothstep(-0.18, 0.55, ndl).mul(float(1.25).sub(ndv.mul(0.58)));
  return max(wing, max(lip, side)).mul(catchesLight);
}

/** Stylized PBR + anime-gouache hybrid shader with controllable hull shadow & corner/edge-riding sheen (4A). */
function paintedPbrShade(
  baseColor: V3,
  opts: ShadeOpts,
  u: ShadeUniforms,
  { page, paint }: Grounds,
): V3 {
  const sunDir = vec3(0.76, 0.36, 0.54).normalize();
  const n = normalWorld.normalize();
  const v = positionViewDirection.normalize();
  const ndl = dot(n, sunDir);
  const ndv = max(dot(normalView.normalize(), v), 0.001);

  const shadowAmt = clamp(u.hullShadow, 0, 1.5);
  const band1 = smoothstep(-0.12, 0.22, ndl);
  const band2 = smoothstep(0.48, 0.82, ndl);
  // Controllable shadow floor directly on the plane (`Plane shadow` knob).
  const floorVal = clamp(float(1).sub(float(1 - opts.shadowFloor).mul(shadowAmt)), 0.08, 0.96);
  const diffuseRamp = floorVal.add(band1.mul(float(0.88).sub(floorVal))).add(band2.mul(0.18));

  let castMask: F = float(0);
  if (opts.planMappedHull) {
    const planUv = uv();
    const wx = planUv.x.mul(2.08).sub(1.04);
    const wy = float(0.36).sub(planUv.y.mul(1.3));
    const inFwdSpan = smoothstep(-0.37, -0.31, wy).mul(float(1).sub(smoothstep(0.115, 0.145, wy)));
    const reach = mix(float(0.175), float(0.258), smoothstep(-0.34, 0.11, wy));
    const inPortBand = smoothstep(reach.negate().sub(0.012), reach.negate().add(0.008), wx).mul(
      float(1).sub(smoothstep(-0.108, -0.092, wx)),
    );
    castMask = inFwdSpan.mul(inPortBand);
  }

  // Stylized PBR microfacet specular + grazing Fresnel + sky/ocean environment gleam.
  const halfVec = sunDir.add(v).normalize();
  const ndh = max(dot(n, halfVec), 0);
  const specExp = Math.max(8, (1 - opts.roughness) * 96);
  const specLobe = pow(ndh, specExp).mul(smoothstep(-0.05, 0.3, ndl));
  const fresnel = pow(clamp(float(1).sub(ndv), 0, 1), 3.6);
  const f0 = mix(vec3(0.04, 0.04, 0.04), baseColor, float(opts.metallic));
  const fresnelCol = f0.add(vec3(1, 1, 1).sub(f0).mul(fresnel));

  const refl = reflect(v.negate(), n);
  const envSky = mix(rgb(18, 138, 162), rgb(246, 240, 224), smoothstep(-0.2, 0.72, refl.z));
  const envGleam = envSky
    .mul(fresnelCol)
    .mul(opts.metallic * 0.62 + (1 - opts.roughness) * 0.22)
    .mul(float(1).sub(castMask.mul(0.8)));

  const cornerRide = opts.planMappedHull
    ? hullEdgeSheen(u.time, ndl, ndv)
        .mul(u.hullSheen)
        .mul(float(1).sub(castMask.mul(0.78)))
    : float(0);
  const sheenColor = vec3(1.0, 0.99, 0.94).add(vec3(0.05, 0.025, -0.05).mul(u.sunWarmth));

  const warmKey = vec3(1.06, 1.01, 0.92).add(vec3(0.08, 0.03, -0.09).mul(u.sunWarmth));
  const pbrSpec = warmKey
    .mul(fresnelCol.add(vec3(0.18, 0.18, 0.18)))
    .mul(specLobe)
    .mul(0.28 + opts.metallic * 1.15)
    .mul(float(1).sub(castMask));

  const inkEdge = smoothstep(0.22, 0.04, ndv).mul(0.32 * (1 - opts.metallic * 0.75));
  const shadowTint = mix(
    mix(vec3(1, 1, 1), rgb(10, 22, 36), clamp(shadowAmt.mul(0.82), 0, 1)),
    vec3(1, 1, 1),
    band1.mul(0.86).add(0.14),
  );
  const seaBounce = mix(rgb(18, 166, 184), rgb(96, 188, 204), float(1).sub(u.dark))
    .mul(clamp(float(1).sub(max(n.z, 0)), 0, 1))
    .mul(0.24)
    .mul(float(1).sub(castMask));

  const diffuseWeight = 1 - opts.metallic * 0.58;
  const litUnshadowed = baseColor
    .mul(diffuseWeight)
    .mul(diffuseRamp)
    .mul(shadowTint)
    .mul(warmKey)
    .mul(float(1).sub(inkEdge))
    .add(seaBounce)
    .add(envGleam)
    .add(pbrSpec);

  const castShadowColor = mix(rgb(14, 34, 50), rgb(5, 14, 26), u.dark);
  const castBlend = clamp(castMask.mul(0.86).mul(shadowAmt), 0, 0.94);
  const lit = mix(litUnshadowed, baseColor.mul(0.13).add(castShadowColor), castBlend);

  const darkOut = darkGrade(clamp(lit, vec3(0, 0, 0), vec3(0.992, 0.992, 0.992)), page);
  const lightOut = clamp(
    mix(lit.mul(1.02), vec3(0.96, 0.96, 0.94), 0.04),
    vec3(0, 0, 0),
    vec3(0.992, 0.992, 0.992),
  );
  // Add the caught light after grading so the ivory paint cannot clip the moving glint.
  return paint(mix(lightOut, darkOut, u.dark)).add(sheenColor.mul(cornerRide.mul(1.25)));
}

/** Painterly brush-broken wave-interactive ocean cast shadow with switchable blend modes. */
function createShadowMaterial(
  shadowTex: Texture,
  u: ShadeUniforms,
  wave: OceanWaveUniforms,
  { paint }: Grounds,
): MeshBasicNodeMaterial {
  const mat = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
  applyShadowBlending(mat, "multiply");
  const baseUv = uv();
  const at = vec2(screenUV.x, float(1).sub(screenUV.y));
  const frameP = vec2(at.x.sub(0.5).mul(u.aspect), at.y.sub(0.5));
  const w = sampleOceanWaveAt(wave, frameP);

  // Wave refraction bends & stretches the shadow silhouette dynamically at vehicle groundspeed.
  const rawMask = texture(shadowTex, baseUv).a;
  const edgeZone = rawMask.mul(float(1).sub(rawMask)).mul(4.0);
  const soft = clamp(u.shadowSoftness, 0, 2);
  const refractAmp = float(0.011).add(edgeZone.mul(0.024)).mul(soft.mul(0.35).add(0.65));
  const atWater = baseUv.add(vec2(w.slopeX.mul(refractAmp), w.slopeY.mul(refractAmp)));
  const warped = texture(shadowTex, atWater).a;
  // Contract the footprint across two brush axes. Thin projections lose most of their
  // pigment while broad wing and fuselage interiors retain full coverage.
  const radius = soft.mul(0.0025).add(0.0035);
  const da = vec2(radius, radius.mul(0.4));
  const db = vec2(radius.mul(-0.4), radius);
  const across = texture(shadowTex, atWater.add(da)).a.min(texture(shadowTex, atWater.sub(da)).a);
  const along = texture(shadowTex, atWater.add(db)).a.min(texture(shadowTex, atWater.sub(db)).a);
  const pigment = mix(across.min(along).min(warped), warped, 0.18);
  const edged = painterlyShadowEdge(
    pigment,
    frameP,
    w,
    soft.add(u.altitudeFactor.sub(1).mul(0.25)),
  );
  const troughCol = mix(rgb(16, 72, 102), rgb(1, 14, 34), u.dark);
  const crestCol = mix(rgb(46, 124, 152), rgb(7, 46, 74), u.dark);
  const waveDensity = mix(float(1.14), float(0.76), w.height);
  const altFade = clamp(float(1.12).sub(u.altitudeFactor.mul(0.22)), 0.55, 1.15);
  const alpha = clamp(
    edged.mask
      .mul(waveDensity)
      .mul(altFade)
      .mul(clamp(u.shadowDepth, 0, 1.5))
      .mul(mix(float(0.62), float(0.84), u.dark)),
    0,
    0.9,
  );
  const blended = composeShadowBlend({
    mode: u.shadowBlend,
    dark: u.dark,
    waveHeight: w.height,
    opacity: alpha,
    wetRim: edged.wetRim,
    normalColor: paint(mix(troughCol, crestCol, w.height.mul(0.55))),
  });
  mat.colorNode = blended.color;
  mat.opacityNode = blended.opacity;
  return mat;
}

function createPlaceholderTexture(): DataTexture {
  const tex = new DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1, RGBAFormat);
  tex.needsUpdate = true;
  return tex;
}

interface MovingParts {
  readonly elevonL: Object3D | null;
  readonly elevonR: Object3D | null;
  readonly elevonTipL: Object3D | null;
  readonly elevonTipR: Object3D | null;
  readonly rudder: Object3D | null;
  readonly fanL: Object3D | null;
  readonly fanR: Object3D | null;
  readonly baseElevonLRotX: number;
  readonly baseElevonRRotX: number;
  readonly baseTipLRotX: number;
  readonly baseTipRRotX: number;
  readonly baseRudderRotY: number;
}

function collectMovingParts(scene: Group): MovingParts {
  const elevonL = scene.getObjectByName("Elevon_L") ?? null;
  const elevonR = scene.getObjectByName("Elevon_R") ?? null;
  const elevonTipL = scene.getObjectByName("ElevonTip_L") ?? null;
  const elevonTipR = scene.getObjectByName("ElevonTip_R") ?? null;
  const rudder = scene.getObjectByName("Tail_VFin") ?? scene.getObjectByName("Rudder_VFin") ?? null;
  const fanL = scene.getObjectByName("TurbineFan_L") ?? null;
  const fanR = scene.getObjectByName("TurbineFan_R") ?? null;
  return {
    elevonL,
    elevonR,
    elevonTipL,
    elevonTipR,
    rudder,
    fanL,
    fanR,
    baseElevonLRotX: elevonL?.rotation.x ?? 0,
    baseElevonRRotX: elevonR?.rotation.x ?? 0,
    baseTipLRotX: elevonTipL?.rotation.x ?? 0,
    baseTipRRotX: elevonTipR?.rotation.x ?? 0,
    baseRudderRotY: rudder?.rotation.y ?? 0,
  };
}

function applyAircraftMaterials(
  scene: Group,
  u: ShadeUniforms,
  grounds: Grounds,
  ownedMaterials: Material[],
  ownedTextures: Texture[],
): void {
  const gunmetalMat = new MeshBasicNodeMaterial();
  gunmetalMat.colorNode = paintedPbrShade(
    rgb(36, 44, 54),
    { metallic: 0.78, roughness: 0.3, shadowFloor: 0.16, planMappedHull: false },
    u,
    grounds,
  );
  const steelMat = new MeshBasicNodeMaterial();
  steelMat.colorNode = paintedPbrShade(
    rgb(168, 178, 188),
    { metallic: 0.9, roughness: 0.18, shadowFloor: 0.24, planMappedHull: false },
    u,
    grounds,
  );
  const darkMat = new MeshBasicNodeMaterial();
  darkMat.colorNode = paintedPbrShade(
    rgb(11, 15, 22),
    { metallic: 0.35, roughness: 0.48, shadowFloor: 0.18, planMappedHull: false },
    u,
    grounds,
  );
  ownedMaterials.push(gunmetalMat, steelMat, darkMat);

  const paintedCache = new Map<Material, MeshBasicNodeMaterial>();
  const importedMaterials = new Set<Material>();

  scene.traverse((obj) => {
    if (!(obj instanceof Mesh)) return;
    const orig = obj.material;
    if (!(orig instanceof MeshStandardMaterial)) return;
    importedMaterials.add(orig);

    if (orig.name === "Core_Gunmetal") {
      obj.material = gunmetalMat;
    } else if (orig.name === "Steel_Bright") {
      obj.material = steelMat;
    } else if (orig.name === "Core_Dark") {
      obj.material = darkMat;
    } else {
      let mapped = paintedCache.get(orig);
      if (!mapped) {
        mapped = new MeshBasicNodeMaterial();
        const albedoMap = orig.map;
        const baseCol = albedoMap
          ? (() => {
              albedoMap.colorSpace = SRGBColorSpace;
              albedoMap.anisotropy = 8;
              albedoMap.needsUpdate = true;
              ownedTextures.push(albedoMap);
              return texture(albedoMap, uv()).rgb;
            })()
          : rgb(228, 220, 202);
        mapped.colorNode = paintedPbrShade(
          baseCol,
          { metallic: 0.1, roughness: 0.44, shadowFloor: 0.26, planMappedHull: true },
          u,
          grounds,
        );
        paintedCache.set(orig, mapped);
        ownedMaterials.push(mapped);
      }
      obj.material = mapped;
    }
  });

  for (const m of importedMaterials) m.dispose();
}

interface AircraftLookOpts {
  readonly dark: boolean;
  readonly sunWarmth: number;
  readonly parallax: number;
  readonly shadowBlend: ShadowBlendMode;
  readonly shadowDepth: number;
  readonly shadowSoftness: number;
  readonly shadowSize: number;
  readonly shadowAltitude: number;
  readonly hullShadow: number;
  readonly hullSheen: number;
}

export interface AircraftRig {
  readonly group: Group;
  readonly hull: Group;
  readonly castShadow: Group;
  readonly ready: Promise<void>;
  readonly flightState: () => AircraftFlightState;
  readonly setLook: (opts: AircraftLookOpts) => void;
  readonly setLayout: (opts: {
    readonly anchorX: number;
    readonly anchorY: number;
    readonly scale: number;
    readonly aspect: number;
    readonly fovDeg: number;
    readonly cameraZ: number;
  }) => void;
  readonly update: (opts: {
    readonly dt: number;
    readonly time: number;
    readonly calm: number;
    readonly pointerOffsetX: number;
    readonly pointerOffsetY: number;
    readonly pointerNear: number;
    readonly dollyX: number;
    readonly dollyY: number;
    readonly speedFactor: number;
    readonly reducedMotion: boolean;
  }) => void;
  readonly dispose: () => void;
}

const isAborted = (signal: AbortSignal): boolean => signal.aborted;

interface AircraftPoseNodes {
  readonly group: Group;
  readonly hull: Group;
  readonly castShadow: Group;
  readonly basePos: Vector3;
}

interface AircraftLayoutState {
  readonly anchorX: number;
  readonly anchorY: number;
  readonly scale: number;
  readonly cameraZ: number;
  readonly tanHalf: number;
}

function applyAircraftPose(
  nodes: AircraftPoseNodes,
  flight: AircraftFlightState,
  layout: AircraftLayoutState,
  opts: {
    readonly dollyX: number;
    readonly dollyY: number;
    readonly parallax: number;
    readonly altMultiplier: number;
    readonly shadowSize: number;
    readonly altU: ScalarUniform;
  },
): void {
  const effectiveZ = Math.max(0.45, AIRCRAFT_Z * opts.altMultiplier + flight.altitudeDelta);
  const altRatio = effectiveZ / AIRCRAFT_Z;
  opts.altU.value = altRatio;

  const worldPerHeight = 2 * layout.cameraZ * layout.tanHalf;
  const airWorldPerHeight = 2 * Math.max(3, layout.cameraZ - effectiveZ) * layout.tanHalf;
  const heading = AIRCRAFT_HEADING_RAD + flight.yawDelta;

  // Higher altitude -> closer to aerial camera (subtle perspective size boost); lower -> closer to water.
  const airScale = layout.scale * airWorldPerHeight * (1.03 + (altRatio - 1) * 0.08);
  const airParallax = 1 + 0.52 * opts.parallax;
  const ax = (layout.anchorX + flight.driftX - opts.dollyX * airParallax) * airWorldPerHeight;
  const ay = (layout.anchorY + flight.driftY - opts.dollyY * airParallax) * airWorldPerHeight;
  nodes.basePos.set(ax, ay, effectiveZ);
  nodes.group.position.copy(nodes.basePos);
  nodes.group.scale.setScalar(airScale);
  nodes.group.rotation.set(0, 0, heading);
  nodes.hull.rotation.set(flight.bankPitch, flight.bankRoll, 0);

  // Higher altitude -> shadow drifts farther down-left & shrinks slightly; lower -> pulls closer & grows larger!
  const shadowScale =
    layout.scale * worldPerHeight * clampRange(1.06 - (altRatio - 1) * 0.16, 0.82, 1.24);
  const shadowShiftX = -0.35 * altRatio * layout.scale;
  const shadowShiftY = -0.15 * altRatio * layout.scale;
  const waterParallax = 1 + 0.08 * opts.parallax;
  const sx =
    (layout.anchorX + shadowShiftX + flight.driftX * 0.7 - opts.dollyX * waterParallax) *
    worldPerHeight;
  const sy =
    (layout.anchorY + shadowShiftY + flight.driftY * 0.7 - opts.dollyY * waterParallax) *
    worldPerHeight;
  nodes.castShadow.position.set(sx, sy, 0);
  nodes.castShadow.scale.setScalar(shadowScale * opts.shadowSize);
  nodes.castShadow.rotation.set(flight.bankPitch * 0.35, flight.bankRoll * 0.35, heading);
}

function animateControlSurfaces(
  parts: MovingParts | null,
  flight: AircraftFlightState,
  time: number,
  speedFactor: number,
  reducedMotion: boolean,
): void {
  if (!parts) return;
  const pitchDeflect = flight.bankPitch * 2.2;
  const rollDeflect = flight.bankRoll * 2.0;
  const leftDeflect = pitchDeflect - rollDeflect;
  const rightDeflect = pitchDeflect + rollDeflect;
  if (parts.elevonL) parts.elevonL.rotation.x = parts.baseElevonLRotX + leftDeflect;
  if (parts.elevonR) parts.elevonR.rotation.x = parts.baseElevonRRotX + rightDeflect;
  if (parts.elevonTipL) parts.elevonTipL.rotation.x = parts.baseTipLRotX + leftDeflect * 0.85;
  if (parts.elevonTipR) parts.elevonTipR.rotation.x = parts.baseTipRRotX + rightDeflect * 0.85;
  if (parts.rudder) parts.rudder.rotation.y = parts.baseRudderRotY + flight.yawDelta * 2.6;
  if (!reducedMotion) {
    const spin = time * (9.5 + speedFactor * 8.5);
    if (parts.fanL) parts.fanL.rotation.z = spin;
    if (parts.fanR) parts.fanR.rotation.z = -spin;
  }
}

async function loadAircraftAssets(opts: {
  readonly signal: AbortSignal;
  readonly hull: Group;
  readonly shadowMesh: Mesh;
  readonly u: ShadeUniforms;
  readonly wave: OceanWaveUniforms;
  readonly grounds: Grounds;
  readonly ownedMaterials: Material[];
  readonly ownedTextures: Texture[];
  readonly onShadowReplaced: (nextMat: MeshBasicNodeMaterial, nextTex: Texture) => void;
  readonly onPartsReady: (parts: MovingParts) => void;
}): Promise<void> {
  const [glbBuf, loadedShadow] = await Promise.all([
    fetch(wb027Url).then((r) => r.arrayBuffer()),
    new TextureLoader().loadAsync(shadowUrl).catch(() => null),
  ]);
  if (isAborted(opts.signal)) {
    loadedShadow?.dispose();
    return;
  }
  if (loadedShadow) {
    loadedShadow.minFilter = LinearMipmapLinearFilter;
    loadedShadow.magFilter = LinearFilter;
    loadedShadow.needsUpdate = true;
    const nextShadowMat = createShadowMaterial(loadedShadow, opts.u, opts.wave, opts.grounds);
    opts.shadowMesh.material = nextShadowMat;
    opts.onShadowReplaced(nextShadowMat, loadedShadow);
    opts.ownedTextures.push(loadedShadow);
  }
  const { scene } = await new GLTFLoader().parseAsync(glbBuf, "");
  if (isAborted(opts.signal)) return;
  scene.rotation.set(Math.PI * 0.5, 0, 0);
  scene.scale.setScalar(MODEL_UNIT_SCALE);
  applyAircraftMaterials(scene, opts.u, opts.grounds, opts.ownedMaterials, opts.ownedTextures);
  opts.onPartsReady(collectMovingParts(scene));
  opts.hull.add(scene);
}

function createShadeUniforms(): ShadeUniforms {
  return {
    dark: makeScalarUniform(1),
    sunWarmth: makeScalarUniform(0),
    aspect: makeScalarUniform(1.7),
    time: makeScalarUniform(0),
    hullShadow: makeScalarUniform(1),
    hullSheen: makeScalarUniform(1),
    shadowBlend: makeScalarUniform(1),
    shadowDepth: makeScalarUniform(1),
    shadowSoftness: makeScalarUniform(1),
    altitudeFactor: makeScalarUniform(1),
  };
}

function applyLookUniforms(u: ShadeUniforms, opts: AircraftLookOpts): void {
  u.dark.value = opts.dark ? 1 : 0;
  u.sunWarmth.value = opts.sunWarmth;
  u.shadowBlend.value = shadowBlendIndex(opts.shadowBlend);
  u.shadowDepth.value = opts.shadowDepth;
  u.shadowSoftness.value = opts.shadowSoftness;
  u.hullShadow.value = opts.hullShadow;
  u.hullSheen.value = opts.hullSheen;
}

export function createAircraftRig(grounds: Grounds, wave: OceanWaveUniforms): AircraftRig {
  const u = createShadeUniforms();
  const group = new Group();
  const hull = new Group();
  group.add(hull);
  const castShadow = new Group();
  const shadowGeo = new PlaneGeometry(2.1 * MODEL_UNIT_SCALE, 2.1 * MODEL_UNIT_SCALE);
  let shadowTex: Texture = createPlaceholderTexture();
  let shadowMat = createShadowMaterial(shadowTex, u, wave, grounds);
  const shadowMesh = new Mesh(shadowGeo, shadowMat);
  castShadow.add(shadowMesh);
  const ownedMaterials: Material[] = [];
  const ownedTextures: Texture[] = [shadowTex];
  const controller = new AbortController();
  let movingParts: MovingParts | null = null;
  let currentBlend: ShadowBlendMode = "multiply";
  let flight: AircraftFlightState = AIRCRAFT_STILL;
  let parallax = 1;
  let altMultiplier = 1;
  let shadowSize = 1;
  let layout: AircraftLayoutState = {
    anchorX: 0.36,
    anchorY: 0,
    scale: 1,
    cameraZ: 10,
    tanHalf: Math.tan((20 * Math.PI) / 180),
  };
  const ready = loadAircraftAssets({
    signal: controller.signal,
    hull,
    shadowMesh,
    u,
    wave,
    grounds,
    ownedMaterials,
    ownedTextures,
    onShadowReplaced: (nextMat, nextTex) => {
      shadowMat.dispose();
      shadowTex.dispose();
      shadowMat = nextMat;
      shadowTex = nextTex;
      applyShadowBlending(shadowMat, currentBlend);
    },
    onPartsReady: (parts) => {
      movingParts = parts;
    },
  });

  const nodes: AircraftPoseNodes = { group, hull, castShadow, basePos: new Vector3() };
  const applyPose = (dollyX: number, dollyY: number) =>
    applyAircraftPose(nodes, flight, layout, {
      dollyX,
      dollyY,
      parallax,
      altMultiplier,
      shadowSize,
      altU: u.altitudeFactor,
    });
  applyPose(0, 0);

  return {
    group,
    hull,
    castShadow,
    ready,
    flightState: () => flight,
    setLook: (opts) => {
      applyLookUniforms(u, opts);
      currentBlend = opts.shadowBlend;
      applyShadowBlending(shadowMat, currentBlend);
      parallax = opts.parallax;
      altMultiplier = opts.shadowAltitude;
      shadowSize = opts.shadowSize;
    },
    setLayout: ({ anchorX, anchorY, scale, aspect, fovDeg, cameraZ }) => {
      u.aspect.value = aspect;
      layout = {
        anchorX,
        anchorY,
        scale,
        cameraZ,
        tanHalf: Math.tan(((fovDeg * Math.PI) / 180) * 0.5),
      };
      applyPose(0, 0);
    },
    update: (step) => {
      u.time.value = step.time;
      flight = step.reducedMotion ? AIRCRAFT_STILL : stepAircraftFlight(flight, step);
      applyPose(step.dollyX, step.dollyY);
      animateControlSurfaces(movingParts, flight, step.time, step.speedFactor, step.reducedMotion);
    },
    dispose: () => {
      controller.abort();
      shadowGeo.dispose();
      shadowMat.dispose();
      for (const m of ownedMaterials) m.dispose();
      for (const t of ownedTextures) t.dispose();
    },
  };
}
