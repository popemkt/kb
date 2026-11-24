/**
 * The Mollusc-inspired TSL (Three.js Shading Language) shader kit for the
 * Blender-sculpted Ichiraku Konoha cyber-ramen backdrop.
 *
 * Key engineering invariants (verified for both WebGPU & WebGL2):
 * - Reflections sample `screenUV.flipX().add(puddleRippleUvOffset)` clamped to
 *   `[0.002, 0.998]`, matching Three.js r186 `ReflectorNode._defaultUV` with a
 *   symmetric camera projection (never `setViewOffset` shear).
 * - Dark mode keeps HDR emissives above `BLOOM_THRESHOLD` with restrained bloom;
 *   light mode disables bloom (`0`) and routes overcast colors through
 *   `stage.paint(...)` (`shoulderGround`) so the stage's shoulder tone curve
 *   outputs crisp, true-value overcast rainy Konoha tones with zero milky wash
 *   or glowing scrim bars.
 * - `textScrim()` blends directly inside scene surface shaders (zero camera
 *   overlay quad that could ghost into the planar reflector pass).
 */
import {
  AdditiveBlending,
  BackSide,
  Color,
  DoubleSide,
  LineBasicNodeMaterial,
  MeshBasicNodeMaterial,
  type Texture,
  type UniformNode,
} from "three/webgpu";
import {
  abs,
  atan,
  cameraPosition,
  clamp,
  cos,
  dot,
  exp,
  float,
  fract,
  length,
  max,
  mix,
  mx_fractal_noise_float,
  normalLocal,
  normalView,
  normalWorld,
  positionLocal,
  positionViewDirection,
  positionWorld,
  pow,
  screenUV,
  sin,
  smoothstep,
  texture,
  uv,
  vec2,
  vec3,
  vertexColor,
} from "three/tsl";
import type { TslNode } from "@kb/scene-gpu";

export interface IchirakuUniforms {
  readonly time: UniformNode<"float", number>;
  readonly writePulse: UniformNode<"float", number>;
  readonly navFlicker: UniformNode<"float", number>;
  readonly dayLift: UniformNode<"float", number>;
  readonly rainAmount: UniformNode<"float", number>;
  readonly neonAmount: UniformNode<"float", number>;
  readonly inkAmount: UniformNode<"float", number>;
  /** Linear 0..1 page ground (`stage.colors.ground`, safe below bloom threshold). */
  readonly page: TslNode<"vec3">;
  /** Stage shoulder pre-image (`stage.paint`) so light-mode colors render exact. */
  readonly paint: (shown: TslNode<"vec3">) => TslNode<"vec3">;
  readonly textUnder: (at: TslNode<"vec2">) => TslNode<"float">;
  readonly brushTex: Texture;
}

const SIGN_POS = vec3(-1.35, 3.35, -1.75);
const TANK_POS = vec3(3.42, 1.65, 1.05);
const WARM_LANTERN_POS = vec3(-1.55, 1.85, -1.35);
const KEY_DIR = vec3(-0.42, 0.78, 0.46).normalize();
const DAY_SUN_DIR = vec3(0.46, 0.74, 0.48).normalize();
const DAY_SUN_RIM_DIR = vec3(0.36, 0.62, -0.7).normalize();
const SIGN_DIR = vec3(-0.62, 0.55, 0.35).normalize();
const CYAN_DIR = vec3(0.76, 0.22, 0.58).normalize();

const CHARTREUSE_RIM = vec3(0.86, 0.94, 0.38);
const CYAN_RIM = vec3(0.24, 0.88, 0.96);
const WARM_LANTERN_COLOR = vec3(1.0, 0.56, 0.2);
const DAY_SKY_HAZE = vec3(0.74, 0.86, 0.98);
const DAY_SUN_WARM = vec3(1.0, 0.95, 0.84);
const DAY_SKY_BOUNCE = vec3(0.62, 0.8, 0.98);
const DAY_GROUND_BOUNCE = vec3(0.92, 0.82, 0.66);

function rgbVec(hex: number): TslNode<"vec3"> {
  const c = new Color(hex);
  return vec3(c.r, c.g, c.b);
}

/** Soft screen-space veil weight over kb's title & breadcrumbs (dark mode only; light mode stays naturally clean). */
function textVeilWeight(shared: IchirakuUniforms): TslNode<"float"> {
  const atUp = vec2(screenUV.x, screenUV.y.oneMinus());
  const underTitle = shared.textUnder(atUp);
  const underCrumbs = smoothstep(0.0, 0.08, screenUV.x)
    .mul(smoothstep(0.56, 0.34, screenUV.x))
    .mul(smoothstep(0.18, 0.04, screenUV.y));
  const strength = mix(float(0.46), float(0.0), shared.dayLift);
  return underTitle
    .mul(strength)
    .add(underCrumbs.mul(strength.mul(0.75)))
    .clamp(0, 0.52);
}

/** Route final display-linear color cleanly for both dark (HDR bloom) and light (exact shoulder pre-image). */
export function finalizeSceneColor(
  shared: IchirakuUniforms,
  nightColor: TslNode<"vec3">,
  dayLinearColor: TslNode<"vec3">,
): TslNode<"vec3"> {
  const veil = textVeilWeight(shared);
  const darkVeiled = mix(nightColor, shared.page, veil);
  const dayVeiled = mix(dayLinearColor, shared.page, veil);
  return mix(darkVeiled, shared.paint(dayVeiled), shared.dayLift);
}

export interface CelOptions {
  readonly base: number;
  readonly shade: number;
  readonly lit: number;
  readonly dayBase?: number;
  readonly dayShade?: number;
  readonly dayLit?: number;
  readonly roughness?: number;
  readonly metalness?: number;
  readonly clearcoat?: number;
  readonly sheen?: number;
  readonly subsurface?: number;
  readonly map?: Texture;
  readonly mapScale?: number;
  readonly warmRim?: number;
  readonly cyanRim?: number;
  readonly lanternSpill?: number;
  readonly brushScale?: number;
  readonly useVertexAo?: boolean;
  readonly doubleSide?: boolean;
}

/**
 * Compute subtle raindrop ripple UV distortion in world XZ to add onto
 * Three.js's canonical `screenUV.flipX()` reflector UV (clamped to [0.002, 0.998]).
 */
function puddleRippleUvOffset(shared: IchirakuUniforms): TslNode<"vec2"> {
  const xz = vec2(positionWorld.x, positionWorld.z);
  const cell1 = xz.mul(1.35);
  const id1 = cell1.floor();
  const loc1 = fract(cell1).sub(0.5);
  const ph1 = fract(
    sin(dot(id1, vec2(127.1, 311.7)))
      .mul(43758.5453)
      .add(shared.time.mul(0.82)),
  );
  const d1 = length(loc1).add(0.001);
  const w1 = sin(d1.sub(ph1.mul(0.48)).mul(34.0))
    .mul(exp(abs(d1.sub(ph1.mul(0.48))).mul(-16.0)))
    .mul(float(1.0).sub(ph1));

  const cell2 = xz.mul(2.15).add(vec2(4.3, 2.7));
  const id2 = cell2.floor();
  const loc2 = fract(cell2).sub(0.5);
  const ph2 = fract(
    sin(dot(id2, vec2(269.5, 183.3)))
      .mul(19341.123)
      .add(shared.time.mul(1.08)),
  );
  const d2 = length(loc2).add(0.001);
  const w2 = sin(d2.sub(ph2.mul(0.44)).mul(40.0))
    .mul(exp(abs(d2.sub(ph2.mul(0.44))).mul(-18.0)))
    .mul(float(1.0).sub(ph2));

  const dir1 = loc1.div(d1);
  const dir2 = loc2.div(d2);
  const rainDrift = vec2(
    sin(xz.y.mul(5.5).add(shared.time.mul(2.1))).mul(0.16),
    cos(xz.x.mul(4.8).sub(shared.time.mul(1.7))).mul(0.12),
  );
  return dir1
    .mul(w1)
    .add(dir2.mul(w2).mul(0.7))
    .add(rainDrift.mul(0.16))
    .mul(0.0062)
    .mul(shared.rainAmount.clamp(0, 1.4));
}

export function reflectorSampleUv(shared: IchirakuUniforms): TslNode<"vec2"> {
  const baseUv = screenUV.flipX();
  return clamp(baseUv.add(puddleRippleUvOffset(shared)), vec2(0.002, 0.002), vec2(0.998, 0.998));
}

/** Energy-normalized Blinn-GGX + Schlick Fresnel + optional wet/lacquer clearcoat specular lobe. */
function pbrSpecLobe(args: {
  readonly n: TslNode<"vec3">;
  readonly v: TslNode<"vec3">;
  readonly l: TslNode<"vec3">;
  readonly roughness: number;
  readonly f0: TslNode<"vec3">;
  readonly clearcoat: TslNode<"float">;
  readonly lightColor: TslNode<"vec3">;
}): TslNode<"vec3"> {
  const h = args.l.add(args.v).normalize();
  const ndh = max(float(0.0), dot(args.n, h));
  const ndl = max(float(0.0), dot(args.n, args.l));
  const vdh = max(float(0.0), dot(args.v, h));
  const fPow = pow(float(1.0).sub(vdh).clamp(0, 1), float(5.0));

  const r = Math.max(0.12, Math.min(0.98, args.roughness));
  const specPow = Math.min(180, Math.max(6, 2 / (r * r * r * r + 0.004)));
  const specNorm = (specPow + 2) / 25.13;
  const fBase = args.f0.add(vec3(1, 1, 1).sub(args.f0).mul(fPow));
  const baseSpec = fBase
    .mul(pow(ndh, float(specPow)))
    .mul(specNorm)
    .mul(ndl);

  const fCoat = vec3(0.04, 0.04, 0.04).add(vec3(0.96, 0.96, 0.96).mul(fPow));
  const coatSpec = fCoat
    .mul(pow(ndh, float(84.0)))
    .mul(2.4)
    .mul(ndl)
    .mul(args.clearcoat);
  return baseSpec.add(coatSpec).mul(args.lightColor);
}

interface SurfaceContext {
  readonly n: TslNode<"vec3">;
  readonly v: TslNode<"vec3">;
  readonly aoCrevice: TslNode<"float">;
  readonly fresnel: TslNode<"float">;
  readonly brushSample: TslNode<"float">;
  readonly brushOffset: TslNode<"float">;
  readonly sideFog: TslNode<"float">;
}

function computeNightPbr(
  shared: IchirakuUniforms,
  opts: CelOptions,
  ctx: SurfaceContext,
): TslNode<"vec3"> {
  const baseCol = rgbVec(opts.base);
  const shadowCol = rgbVec(opts.shade);
  const litCol = rgbVec(opts.lit);
  const rough = opts.roughness ?? 0.65;
  const metal = opts.metalness ?? 0.0;
  const wetCoat = float(opts.clearcoat ?? 0.0)
    .add(smoothstep(0.45, 0.95, ctx.n.y).mul(0.38).mul(shared.rainAmount.clamp(0.1, 1.3)))
    .clamp(0, 1.0);

  const ndl = dot(ctx.n, KEY_DIR).add(ctx.brushOffset).sub(float(1.0).sub(ctx.aoCrevice).mul(0.58));
  const shadowBand = smoothstep(-0.18, 0.04, ndl);
  const litBand = smoothstep(0.34, 0.5, ndl);
  let albedo = mix(shadowCol, mix(baseCol, litCol, litBand), shadowBand);
  albedo = mix(shadowCol.mul(0.42), albedo, ctx.aoCrevice.mul(0.84).add(0.16));

  if (opts.map !== undefined) {
    const scale = opts.mapScale ?? 1;
    const uvXY = vec2(positionWorld.x.mul(scale), positionWorld.y.mul(scale));
    const uvZY = vec2(positionWorld.z.mul(scale), positionWorld.y.mul(scale));
    const wallUv = mix(uvXY, uvZY, smoothstep(0.42, 0.58, abs(ctx.n.x)));
    albedo = mix(albedo, albedo.mul(texture(opts.map, wallUv).rgb.mul(2.15)), 0.72);
  }
  albedo = albedo.mul(ctx.brushSample.sub(0.5).mul(0.26).add(0.86));
  const flankQuiet = smoothstep(10.5, 4.4, abs(positionWorld.x)).mul(0.58).add(0.42);
  const diffuse = albedo.mul(flankQuiet).mul(1 - metal * 0.45);
  const f0 = mix(vec3(0.04, 0.04, 0.04), litCol.mul(1.35), metal);

  const signVec = SIGN_POS.sub(positionWorld);
  const signAtt = smoothstep(6.8, 1.2, length(signVec)).mul(shared.neonAmount);
  const signSpec = pbrSpecLobe({
    n: ctx.n,
    v: ctx.v,
    l: signVec.normalize(),
    roughness: rough,
    f0,
    clearcoat: wetCoat,
    lightColor: CHARTREUSE_RIM.mul(signAtt).mul(0.58),
  });

  const tankVec = TANK_POS.sub(positionWorld);
  const tankAtt = smoothstep(5.4, 0.9, length(tankVec)).mul(shared.neonAmount);
  const tankSpec = pbrSpecLobe({
    n: ctx.n,
    v: ctx.v,
    l: tankVec.normalize(),
    roughness: rough,
    f0,
    clearcoat: wetCoat,
    lightColor: CYAN_RIM.mul(tankAtt).mul(0.68),
  });

  const lanternVec = WARM_LANTERN_POS.sub(positionWorld);
  const lanternDist = length(lanternVec);
  const lanternL = lanternVec.normalize();
  const lanternMask = exp(lanternDist.mul(lanternDist).mul(-0.34))
    .mul(ctx.aoCrevice.mul(0.65).add(0.35))
    .mul(float(1.0).add(shared.writePulse.mul(0.35)));
  const lanternDiffuse = WARM_LANTERN_COLOR.mul(lanternMask)
    .mul(max(float(0.06), dot(ctx.n, lanternL)))
    .mul((opts.lanternSpill ?? 0.35) * 0.72);
  const lanternSpec = pbrSpecLobe({
    n: ctx.n,
    v: ctx.v,
    l: lanternL,
    roughness: rough,
    f0,
    clearcoat: wetCoat,
    lightColor: WARM_LANTERN_COLOR.mul(lanternMask).mul(0.85),
  });

  const rimVis = ctx.aoCrevice.mul(0.75).add(0.25);
  const warmRimGlow = CHARTREUSE_RIM.mul(
    smoothstep(0.54, 0.68, ctx.fresnel.mul(smoothstep(0.2, 0.65, dot(ctx.n, SIGN_DIR)))),
  )
    .mul(signAtt)
    .mul(rimVis)
    .mul((opts.warmRim ?? 0.9) * 0.52);
  const cyanRimGlow = CYAN_RIM.mul(
    smoothstep(0.55, 0.69, ctx.fresnel.mul(smoothstep(0.2, 0.65, dot(ctx.n, CYAN_DIR)))),
  )
    .mul(tankAtt)
    .mul(rimVis)
    .mul((opts.cyanRim ?? 0.8) * 0.48);

  const upFace = smoothstep(0.55, 0.95, ctx.n.y).mul(ctx.aoCrevice);
  const skySpec = vec3(0.05, 0.08, 0.12)
    .mul(upFace)
    .mul(wetCoat.mul(0.65).add(0.35))
    .mul(shared.rainAmount.clamp(0.2, 1.3));

  return mix(
    diffuse
      .add(lanternDiffuse)
      .add(signSpec.add(tankSpec).add(lanternSpec).mul(ctx.aoCrevice.mul(0.75).add(0.25)))
      .add(warmRimGlow)
      .add(cyanRimGlow)
      .add(skySpec),
    shared.page,
    ctx.sideFog.mul(0.92),
  );
}

function computeDayPbr(
  shared: IchirakuUniforms,
  opts: CelOptions,
  ctx: SurfaceContext,
): TslNode<"vec3"> {
  const dBaseCol = rgbVec(opts.dayBase ?? opts.lit);
  const dShadeCol = rgbVec(opts.dayShade ?? opts.base);
  const dLitCol = rgbVec(opts.dayLit ?? opts.lit);
  const rough = opts.roughness ?? 0.65;
  const metal = opts.metalness ?? 0.0;
  const coat = float(opts.clearcoat ?? 0.0);

  const dayNdl = dot(ctx.n, DAY_SUN_DIR)
    .add(ctx.brushOffset)
    .sub(float(1.0).sub(ctx.aoCrevice).mul(0.5));
  const dayShadowBand = smoothstep(-0.16, 0.08, dayNdl);
  const dayLitBand = smoothstep(0.26, 0.48, dayNdl);
  let surface = mix(dShadeCol, mix(dBaseCol, dLitCol.mul(DAY_SUN_WARM), dayLitBand), dayShadowBand);
  surface = mix(dShadeCol.mul(0.7), surface, ctx.aoCrevice.mul(0.84).add(0.16));

  if (opts.map !== undefined) {
    const scale = opts.mapScale ?? 1;
    const uvXY = vec2(positionWorld.x.mul(scale), positionWorld.y.mul(scale));
    const uvZY = vec2(positionWorld.z.mul(scale), positionWorld.y.mul(scale));
    const wallUv = mix(uvXY, uvZY, smoothstep(0.42, 0.58, abs(ctx.n.x)));
    const detail = texture(opts.map, wallUv).rgb;
    surface = mix(surface, surface.mul(detail.mul(1.25).add(vec3(0.24, 0.24, 0.24))), 0.62);
  }
  surface = surface.mul(ctx.brushSample.sub(0.5).mul(0.18).add(0.94));

  // Physical sky-blue hemisphere ambient + warm sunlit street bounce under downward-facing eaves!
  const hemiFactor = ctx.n.y.mul(0.5).add(0.5).clamp(0, 1);
  const hemiBounce = mix(DAY_GROUND_BOUNCE, DAY_SKY_BOUNCE, hemiFactor)
    .mul(ctx.aoCrevice.mul(0.6).add(0.4))
    .mul(0.14);

  // Real directional afternoon sun PBR specular + clearcoat sun-glints + metal IBL sky tint!
  const f0 = mix(vec3(0.04, 0.04, 0.04), dLitCol, metal);
  const sunSpec = pbrSpecLobe({
    n: ctx.n,
    v: ctx.v,
    l: DAY_SUN_DIR,
    roughness: rough,
    f0,
    clearcoat: coat,
    lightColor: DAY_SUN_WARM.mul(0.75),
  }).mul(ctx.aoCrevice.mul(0.7).add(0.3));

  const envReflect = mix(DAY_GROUND_BOUNCE, DAY_SKY_BOUNCE, hemiFactor)
    .mul(f0)
    .mul(ctx.fresnel.mul(0.65).add(0.35))
    .mul(metal * 0.55 + (opts.clearcoat ?? 0) * 0.16)
    .mul(ctx.aoCrevice);

  // Golden back-rim grazing mountain crest, tiled eaves & leaves from the visible sun behind Hokage Mountain!
  const backRim = vec3(1.0, 0.88, 0.62)
    .mul(pow(ctx.fresnel, float(2.4)))
    .mul(smoothstep(0.05, 0.72, dot(ctx.n, DAY_SUN_RIM_DIR).add(0.25)))
    .mul(ctx.aoCrevice)
    .mul(0.28);

  const clothSheen = dLitCol.mul(pow(ctx.fresnel, float(2.2))).mul((opts.sheen ?? 0) * 0.34);
  const leafSss = vec3(0.84, 0.96, 0.38)
    .mul(smoothstep(-0.1, 0.85, dot(ctx.n, DAY_SUN_DIR)))
    .mul(ctx.fresnel.mul(0.55).add(0.45))
    .mul((opts.subsurface ?? 0) * 0.32);

  const depthMist = smoothstep(6.5, 22.0, positionWorld.z.negate()).mul(0.22);
  const lit = surface
    .mul(1 - metal * 0.32)
    .add(hemiBounce)
    .add(sunSpec)
    .add(envReflect)
    .add(backRim)
    .add(clothSheen)
    .add(leafSss);
  return mix(mix(lit, DAY_SKY_HAZE, depthMist), shared.page, ctx.sideFog.mul(0.9));
}

export function painterlyCelMaterial(
  shared: IchirakuUniforms,
  opts: CelOptions,
): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial();
  if (opts.doubleSide === true) material.side = DoubleSide;

  const bScale = opts.brushScale ?? 0.55;
  const brushUv = vec2(
    positionWorld.x.add(positionWorld.z).mul(bScale),
    positionWorld.y.mul(bScale),
  );
  const brushSample = texture(shared.brushTex, brushUv).r;
  const brushOffset = brushSample.sub(0.5).mul(0.24);

  const ao = opts.useVertexAo === true ? vertexColor().r.clamp(0, 1) : float(1.0);
  const aoCrevice = smoothstep(0.08, 0.92, ao);
  const n = normalWorld.normalize();
  const v = cameraPosition.sub(positionWorld).normalize();
  const fresnel = float(1.0)
    .sub(abs(dot(normalView, positionViewDirection)))
    .clamp(0, 1);
  const sideFog = smoothstep(7.8, 13.8, abs(positionWorld.x));

  const ctx: SurfaceContext = { n, v, aoCrevice, fresnel, brushSample, brushOffset, sideFog };
  const nightLit = computeNightPbr(shared, opts, ctx);
  const dayLit = computeDayPbr(shared, opts, ctx);

  material.colorNode = finalizeSceneColor(shared, nightLit, dayLit);
  return material;
}

export function creaseLineMaterial(
  shared: IchirakuUniforms,
  opts: { readonly hex: number; readonly baseOpacity: number; readonly glow?: number },
): LineBasicNodeMaterial {
  const material = new LineBasicNodeMaterial();
  material.transparent = true;
  material.depthWrite = false;
  const col = rgbVec(opts.hex);
  const glow = opts.glow ?? 1.0;
  const dayScale = mix(float(1.0), float(0.48), shared.dayLift);
  const sideFade = smoothstep(12.2, 6.8, abs(positionWorld.x));
  const veilFade = float(1.0).sub(textVeilWeight(shared));
  material.colorNode = mix(col.mul(glow), shared.paint(vec3(0.14, 0.18, 0.23)), shared.dayLift);
  material.opacityNode = float(opts.baseOpacity)
    .mul(shared.inkAmount)
    .mul(dayScale)
    .mul(sideFade)
    .mul(veilFade)
    .clamp(0, 0.88);
  return material;
}

export function inkOutlineMaterial(shared: IchirakuUniforms, width: number): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial();
  material.side = BackSide;
  const scaledWidth = float(width).mul(mix(float(1.0), float(0.55), shared.dayLift));
  material.positionNode = positionLocal.add(normalLocal.mul(scaledWidth));
  material.colorNode = finalizeSceneColor(
    shared,
    vec3(0.035, 0.028, 0.055),
    vec3(0.18, 0.22, 0.27),
  );
  return material;
}

export function norenClothMaterial(
  shared: IchirakuUniforms,
  norenTex: Texture,
  phaseOffset: number,
  sagAmount: number,
): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial();
  material.side = DoubleSide;

  const hang = float(1.0).sub(uv().y);
  const gust = float(1.0).add(shared.writePulse.mul(1.8)).add(shared.navFlicker.mul(0.8));
  const swayZ = sin(shared.time.mul(1.85).add(positionLocal.x.mul(2.1)).add(phaseOffset))
    .mul(0.052)
    .mul(hang.mul(hang))
    .mul(gust);
  const wetSagY = hang.mul(hang).mul(-sagAmount);
  material.positionNode = positionLocal.add(vec3(0, wetSagY, swayZ));

  const linen = texture(norenTex, uv()).rgb;
  const warmBack = vec3(0.95, 0.62, 0.24)
    .mul(hang.mul(0.5).add(0.24))
    .mul(float(1.0).add(shared.writePulse.mul(0.32)));
  const dampBottom = mix(float(0.68), float(1.0), uv().y);
  const nightLit = linen
    .mul(vec3(0.72, 0.66, 0.56))
    .mul(dampBottom)
    .add(warmBack.mul(0.32));
  const dayLit = linen
    .mul(vec3(0.82, 0.8, 0.76))
    .mul(dampBottom)
    .add(warmBack.mul(0.14));
  material.colorNode = finalizeSceneColor(shared, nightLit, dayLit);
  return material;
}

export function fresnelGlassMaterial(
  shared: IchirakuUniforms,
  opts: { readonly tint: number; readonly rim: number; readonly isTube?: boolean },
): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial();
  material.transparent = true;
  material.depthWrite = false;
  material.side = DoubleSide;

  const ndv = abs(dot(normalView, positionViewDirection)).clamp(0, 1);
  const fresnel = pow(float(1.0).sub(ndv), float(opts.isTube === true ? 2.0 : 2.35));

  const tintCol = rgbVec(opts.tint);
  const rimCol = rgbVec(opts.rim);
  const pulse = float(1.0).add(shared.writePulse.mul(0.38));

  const tubeScale = opts.isTube === true ? 0.42 : 0.68;
  const nightCol = mix(tintCol.mul(0.35), rimCol.mul(1.05), fresnel)
    .mul(pulse)
    .mul(tubeScale)
    .mul(shared.neonAmount);
  const dayCol = mix(tintCol.mul(0.45), rimCol.mul(0.72), fresnel).mul(tubeScale);

  material.colorNode = mix(nightCol, shared.paint(dayCol), shared.dayLift);
  material.opacityNode = fresnel
    .mul(opts.isTube === true ? 0.54 : 0.62)
    .add(opts.isTube === true ? 0.14 : 0.08)
    .clamp(0.06, 0.78);
  return material;
}

function puddleSplashRipples(
  shared: IchirakuUniforms,
  worldXZ: TslNode<"vec2">,
  puddleMask: TslNode<"float">,
): TslNode<"float"> {
  const cell1 = worldXZ.mul(1.35);
  const id1 = cell1.floor();
  const loc1 = fract(cell1).sub(0.5);
  const ph1 = fract(
    sin(dot(id1, vec2(127.1, 311.7)))
      .mul(43758.5453)
      .add(shared.time.mul(0.82)),
  );
  const r1 = smoothstep(0.028, 0.0, abs(length(loc1).sub(ph1.mul(0.44))))
    .mul(float(1.0).sub(ph1))
    .mul(puddleMask);

  const cell2 = worldXZ.mul(2.15).add(vec2(4.3, 2.7));
  const id2 = cell2.floor();
  const loc2 = fract(cell2).sub(0.5);
  const ph2 = fract(
    sin(dot(id2, vec2(269.5, 183.3)))
      .mul(19341.123)
      .add(shared.time.mul(1.08)),
  );
  const r2 = smoothstep(0.024, 0.0, abs(length(loc2).sub(ph2.mul(0.42))))
    .mul(float(1.0).sub(ph2))
    .mul(puddleMask);

  return r1.add(r2.mul(0.75)).clamp(0, 1).mul(shared.rainAmount);
}

export function wetAsphaltMaterial(
  shared: IchirakuUniforms,
  reflectionColor: TslNode<"vec3">,
): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial();
  const worldXZ = vec2(positionWorld.x, positionWorld.z);

  const puddleNoise = mx_fractal_noise_float(
    vec3(worldXZ.x.mul(0.36), worldXZ.y.mul(0.42), float(2.1)),
    3,
    2.1,
    0.55,
  )
    .mul(0.5)
    .add(0.5);
  const drainBasin = exp(length(worldXZ.sub(vec2(2.6, -0.4))).mul(-0.65)).mul(0.32);
  const stallBasin = exp(length(worldXZ.sub(vec2(-1.2, 0.35))).mul(-0.48)).mul(0.28);
  const puddleHeight = puddleNoise.add(drainBasin).add(stallBasin);
  const puddleMask = smoothstep(0.46, 0.62, puddleHeight).clamp(0, 1);
  const puddleRim = smoothstep(0.44, 0.52, puddleHeight).mul(smoothstep(0.64, 0.52, puddleHeight));
  const rippleSpec = puddleSplashRipples(shared, worldXZ, puddleMask);

  const grain = texture(shared.brushTex, worldXZ.mul(0.85)).r;
  const dryAsphalt = mix(vec3(0.011, 0.014, 0.021), vec3(0.036, 0.042, 0.056), grain);
  // Warm sunlit Konoha stone-paved street in daytime mode!
  const dayAsphalt = mix(vec3(0.62, 0.59, 0.54), vec3(0.76, 0.72, 0.66), grain);

  // Warm golden counter pool spilling naturally onto the wet ground under the 5 stools!
  const stallDelta = worldXZ.sub(vec2(-1.45, -0.45));
  const stallPool = exp(
    stallDelta.x.mul(stallDelta.x).mul(-0.24).sub(stallDelta.y.mul(stallDelta.y).mul(0.42)),
  ).mul(vec3(0.48, 0.26, 0.09));

  const tankDelta = worldXZ.sub(vec2(2.85, 0.58));
  const tankPool = exp(
    tankDelta.x.mul(tankDelta.x).mul(-0.32).sub(tankDelta.y.mul(tankDelta.y).mul(0.46)),
  )
    .mul(vec3(0.08, 0.34, 0.4))
    .mul(shared.neonAmount);

  const bikeShadow = smoothstep(0.38, 1.05, length(worldXZ.sub(vec2(1.52, -0.32))));
  const kioskShadow = smoothstep(0.52, 1.15, length(worldXZ.sub(vec2(3.42, 1.05))));
  const stallShadow = smoothstep(0.65, 1.45, length(worldXZ.sub(vec2(-1.55, -1.35))));
  const groundAo = bikeShadow
    .mul(0.55)
    .add(0.45)
    .mul(kioskShadow.mul(0.52).add(0.48))
    .mul(stallShadow.mul(0.4).add(0.6));

  const ndv = abs(dot(normalView, positionViewDirection)).clamp(0, 1);
  const fresnel = pow(float(1.0).sub(ndv), float(1.35)).mul(0.45).add(0.55);
  // Sharp mirror reflection inside puddles (`0.88`), dark damp sheen (`0.20`) on surrounding asphalt!
  const reflectWeight = mix(float(0.18), float(0.92), puddleMask).mul(fresnel).clamp(0, 0.94);

  const rippleTint = mix(
    mix(WARM_LANTERN_COLOR, CYAN_RIM, smoothstep(-0.8, 2.6, positionWorld.x)),
    vec3(0.84, 0.88, 0.92),
    shared.dayLift,
  );
  const nightRippleGlint = rippleTint
    .mul(rippleSpec)
    .mul(0.24)
    .add(puddleRim.mul(vec3(0.04, 0.05, 0.07)));
  const dayRippleGlint = vec3(0.82, 0.9, 0.98)
    .mul(rippleSpec)
    .mul(0.08)
    .add(puddleRim.mul(vec3(0.06, 0.09, 0.12)));

  const safeNightRefl = reflectionColor.clamp(vec3(0, 0, 0), vec3(2.4, 2.4, 2.4));
  // Crisp sunlit cerulean sky + warm building reflections inside post-shower daytime puddles!
  const safeDayRefl = mix(
    reflectionColor.clamp(vec3(0, 0, 0), vec3(1.0, 1.0, 1.0)),
    vec3(0.46, 0.74, 0.96),
    0.36,
  );

  const sideFog = smoothstep(7.6, 13.8, abs(positionWorld.x));
  const nearFade = smoothstep(4.2, 6.2, positionWorld.z);
  const edgeMask = sideFog.max(nearFade).mul(0.95);

  const nightStreet = mix(
    mix(dryAsphalt, safeNightRefl.mul(1.12), reflectWeight)
      .add(stallPool)
      .add(tankPool)
      .add(nightRippleGlint)
      .mul(groundAo),
    shared.page,
    edgeMask,
  );
  const daySunDelta = worldXZ.sub(vec2(0.45, -0.35));
  const cloudDrift = sin(worldXZ.x.mul(0.28).add(shared.time.mul(0.22)))
    .mul(0.08)
    .add(0.92);
  const daySunPool = exp(
    daySunDelta.x.mul(daySunDelta.x).mul(-0.14).sub(daySunDelta.y.mul(daySunDelta.y).mul(0.26)),
  )
    .mul(vec3(0.22, 0.18, 0.1))
    .mul(cloudDrift);

  const dayStreet = mix(
    mix(dayAsphalt, safeDayRefl, reflectWeight.mul(0.84))
      .add(daySunPool)
      .add(dayRippleGlint)
      .mul(groundAo.mul(0.38).add(0.62)),
    shared.page,
    edgeMask,
  );

  material.colorNode = finalizeSceneColor(shared, nightStreet, dayStreet);
  return material;
}

export function rainStreakMaterial(shared: IchirakuUniforms): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial();
  material.transparent = true;
  material.depthWrite = false;
  material.blending = AdditiveBlending;
  material.side = DoubleSide;

  const coreX = smoothstep(0.5, 0.08, abs(uv().x.sub(0.5)));
  const taperY = smoothstep(0.0, 0.25, uv().y).mul(smoothstep(1.0, 0.15, uv().y));

  const signProx = smoothstep(5.4, 1.1, length(positionWorld.sub(SIGN_POS)));
  const lanternProx = smoothstep(4.2, 0.9, length(positionWorld.sub(WARM_LANTERN_POS)));
  const tankProx = smoothstep(4.0, 0.8, length(positionWorld.sub(TANK_POS)));
  const lightCatch = signProx.mul(0.75).add(lanternProx.mul(0.65)).add(tankProx.mul(0.55));

  const nightCol = vec3(0.32, 0.38, 0.44)
    .add(CHARTREUSE_RIM.mul(signProx).mul(0.65).mul(shared.neonAmount))
    .add(WARM_LANTERN_COLOR.mul(lanternProx).mul(0.52))
    .add(CYAN_RIM.mul(tankProx).mul(0.52).mul(shared.neonAmount));

  const quietUnderText = float(1.0).sub(textVeilWeight(shared).mul(1.4)).clamp(0.15, 1.0);
  const sideFade = smoothstep(12.2, 6.8, abs(positionWorld.x));

  material.colorNode = mix(nightCol, shared.paint(vec3(0.86, 0.92, 0.96)), shared.dayLift);
  material.opacityNode = coreX
    .mul(taperY)
    .mul(float(0.045).add(lightCatch.mul(0.32)))
    .mul(shared.rainAmount)
    .mul(quietUnderText)
    .mul(sideFade)
    // Light mode is a clear sunny post-shower Konoha afternoon (puddles remain, zero falling rain!).
    .mul(mix(float(1.0), float(0.0), shared.dayLift));
  return material;
}

export function steamWispMaterial(shared: IchirakuUniforms, phase: number): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial();
  material.transparent = true;
  material.depthWrite = false;
  material.blending = AdditiveBlending;
  material.side = DoubleSide;

  const p = uv();
  const scroll = vec3(
    p.x.mul(2.1).add(sin(p.y.mul(4.2).sub(shared.time.mul(1.1))).mul(0.22)),
    p.y.mul(2.0).sub(shared.time.mul(0.42)).add(float(phase)),
    shared.time.mul(0.14),
  );
  const wisp = mx_fractal_noise_float(scroll, 3, 2.0, 0.5).mul(0.5).add(0.5);
  const radial = smoothstep(0.5, 0.08, abs(p.x.sub(0.5)))
    .mul(smoothstep(0.0, 0.24, p.y))
    .mul(smoothstep(1.0, 0.16, p.y));

  material.colorNode = mix(
    vec3(1.0, 0.84, 0.56),
    shared.paint(vec3(0.84, 0.88, 0.92)),
    shared.dayLift,
  );
  material.opacityNode = smoothstep(0.34, 0.84, wisp)
    .mul(radial)
    .mul(float(0.22).add(shared.writePulse.mul(0.18)))
    .mul(mix(float(1.0), float(0.42), shared.dayLift));
  return material;
}

export function groundMistMaterial(shared: IchirakuUniforms, phase: number): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial();
  material.transparent = true;
  material.depthWrite = false;
  material.side = DoubleSide;

  const p = uv();
  const drift = vec3(
    p.x.mul(1.8).add(shared.time.mul(0.06)).add(float(phase)),
    p.y.mul(2.2),
    shared.time.mul(0.05),
  );
  const cloud = mx_fractal_noise_float(drift, 3, 2.0, 0.5).mul(0.5).add(0.5);
  const radial = smoothstep(1.0, 0.15, length(p.sub(0.5).mul(2.0)));

  material.colorNode = mix(vec3(0.14, 0.19, 0.23), shared.paint(DAY_SKY_HAZE), shared.dayLift);
  material.opacityNode = smoothstep(0.32, 0.85, cloud)
    .mul(radial)
    .mul(radial)
    .mul(mix(float(0.14), float(0.05), shared.dayLift));
  return material;
}

/** Radiant afternoon sun disc & rotating sunburst corona (light mode only). */
export function sunDiscMaterial(
  shared: IchirakuUniforms,
  isWideHalo: boolean,
): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial();
  material.transparent = true;
  material.depthWrite = false;
  material.side = DoubleSide;

  const p = uv().sub(0.5).mul(2.0);
  const r = length(p);
  const angle = atan(p.y, p.x);
  const spokes = sin(angle.mul(8.0).add(shared.time.mul(0.22)))
    .mul(0.5)
    .add(0.5)
    .mul(0.38)
    .add(0.62);
  const pulse = sin(shared.time.mul(1.15)).mul(0.05).add(0.95);

  if (isWideHalo) {
    const glow = smoothstep(1.0, 0.0, r);
    material.colorNode = shared.paint(mix(vec3(1.0, 0.9, 0.68), vec3(1.0, 0.97, 0.84), glow));
    material.opacityNode = glow.mul(glow).mul(0.52).mul(pulse).mul(shared.dayLift);
    return material;
  }

  const core = smoothstep(0.42, 0.18, r);
  const corona = smoothstep(1.0, 0.16, r).mul(spokes);
  const sunCol = mix(vec3(1.0, 0.86, 0.5), vec3(1.0, 0.99, 0.92), core);
  material.colorNode = shared.paint(sunCol);
  material.opacityNode = core.max(corona.mul(0.72)).mul(pulse).mul(shared.dayLift);
  return material;
}

/** Animated diagonal volumetric sunbeams slanting across Konoha alley (light mode only). */
export function sunRayMaterial(
  shared: IchirakuUniforms,
  phase: number,
  strength: number,
): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial();
  material.transparent = true;
  material.depthWrite = false;
  material.side = DoubleSide;

  const p = uv();
  const across = smoothstep(0.5, 0.05, abs(p.x.sub(0.5)));
  const along = smoothstep(0.0, 0.32, p.y).mul(smoothstep(1.0, 0.08, p.y));
  const shafts = sin(p.x.mul(14.0).add(shared.time.mul(0.24)).add(float(phase)))
    .mul(0.24)
    .add(0.76);
  const shimmer = mx_fractal_noise_float(
    vec3(p.x.mul(2.4), p.y.mul(1.4).sub(shared.time.mul(0.09)), float(phase)),
    2,
    2.0,
    0.5,
  )
    .mul(0.32)
    .add(0.78);

  material.colorNode = shared.paint(mix(vec3(1.0, 0.91, 0.66), vec3(1.0, 0.97, 0.82), p.y));
  material.opacityNode = across
    .mul(across)
    .mul(along)
    .mul(shafts)
    .mul(shimmer)
    .mul(strength)
    .mul(shared.dayLift)
    .clamp(0, 0.42);
  return material;
}
