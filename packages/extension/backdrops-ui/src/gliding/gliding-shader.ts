/**
 * Gliding's Vast 3-Layer Painterly Gouache Ocean shader: an aerial top-down
 * view of an endless sunlit tropical-to-marine ocean painted in the hand-
 * illustrated gouache aesthetic of anime film backgrounds.
 *
 * Three true depth planes with customizable inter-layer parallax & animation:
 * 1. **Deep Seabed & Shallows (`sampleSeabed`)**: slowest parallax plane —
 *    broad undulating sandbar depth shoals, deep Prussian marine troughs, and
 *    animated oblique submerged caustic cross-hatching (`applyShallowCaustics`).
 * 2. **Mid-Water Gouache Swells (`sampleMidWater`)**: middle parallax plane —
 *    sweeping domain-warped ocean currents, sculpted sunlit/shaded wave faces,
 *    overlapping curved flat-brush dabs, and matte pigment granulation.
 * 3. **Surface Chalky Sea-Foam (`applySeaFoam`)**: fastest surface plane —
 *    open S-curved chalky crest spines, true netted cellular bubble-web aprons,
 *    branching foam wisps, and feathery translucent aqua spray trails.
 *
 * Vastness & Blending:
 * - Full-bleed edge-to-edge horizontally and to the top chrome bar so the ocean
 *   reads as vast and boundless rather than vignetted inside a small pill.
 * - Organic undulating gouache-wash dissolve along the bottom edge (`bottomDissolve`)
 *   so page-head content merges seamlessly with zero straight cut-off line on
 *   both dark and light themes at desktop, ultra-wide, and mobile widths.
 */
import {
  Fn,
  If,
  abs,
  clamp,
  float,
  floor,
  fract,
  fwidth,
  max,
  min,
  mix,
  pow,
  screenUV,
  sin,
  smoothstep,
  uniform,
  vec2,
  vec3,
} from "three/tsl";
import { Vector2 } from "three/webgpu";
import type { TslNode } from "@kb/scene-gpu";
import { darkGrade } from "../gpu/dark-grade";
import type { Grounds } from "../gpu/gpu-scene";
import { gnoise, hash } from "../gpu/noise";
import { textScrim } from "../gpu/text-scrim";
import { glidingTuning } from "./gliding-tuning";

type F = TslNode<"float">;
type V2 = TslNode<"vec2">;
type V3 = TslNode<"vec3">;

/** Flight heading (NE, ~40°): scrolling sample coordinates along +HEADING glides water toward SW (lower-left). */
const HEADING_X = 0.766;
const HEADING_Y = 0.643;
/** Primary wave-crest & foam-current axis (~32° SW-to-NE diagonal). */
const BRUSH_COS = 0.848;
const BRUSH_SIN = 0.53;
/** Secondary overlapping brushstroke axis (~24° offset for painterly cross-layered dabs). */
const CROSS_COS = 0.99;
const CROSS_SIN = 0.139;

const lin = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const rgb = (r: number, g: number, b: number): V3 => vec3(lin(r / 255), lin(g / 255), lin(b / 255));
const align = (p: V2, cosA: number, sinA: number): V2 =>
  vec2(p.x.mul(cosA).add(p.y.mul(sinA)), p.y.mul(cosA).sub(p.x.mul(sinA)));
const turn = (p: V2): V2 => vec2(p.x.mul(1.6).sub(p.y.mul(1.2)), p.x.mul(1.2).add(p.y.mul(1.6)));

/** Fast scalar value noise (quintic smooth) for crisp brushwork, foam lace and paper tooth. */
const vnoiseFn = Fn(([p]: readonly [V2]) => {
  const i = floor(p).toVar();
  const f = fract(p).toVar();
  const u = f
    .mul(f)
    .mul(f)
    .mul(f.mul(f.mul(6).sub(15)).add(10));
  const a = hash(i);
  const b = hash(i.add(vec2(1, 0)));
  const c = hash(i.add(vec2(0, 1)));
  const d = hash(i.add(vec2(1, 1)));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}).setLayout({ name: "kbGlideVnoise", type: "float", inputs: [{ name: "p", type: "vec2" }] });

const vfbm2Fn = Fn(([start]: readonly [V2]) => {
  const n0 = vnoiseFn(start);
  const n1 = vnoiseFn(turn(start).add(vec2(5.3, 2.7)));
  return n0.mul(0.64).add(n1.mul(0.36));
}).setLayout({ name: "kbGlideVfbm2", type: "float", inputs: [{ name: "p", type: "vec2" }] });

const fbm2Fn = Fn(([start]: readonly [V2]) => {
  const n0 = gnoise(start);
  const n1 = gnoise(turn(start).add(vec2(3.7, 1.9)));
  return n0.mul(0.66).add(n1.mul(0.34));
}).setLayout({ name: "kbGlideFbm2", type: "float", inputs: [{ name: "p", type: "vec2" }] });

const swellFbmFn = Fn(([start]: readonly [V2]) => {
  const p1 = turn(start).add(vec2(2.3, 4.1)).toVar();
  const p2 = turn(p1).add(vec2(5.1, 1.7));
  return gnoise(start).mul(0.54).add(vnoiseFn(p1).mul(0.3)).add(vnoiseFn(p2).mul(0.16));
}).setLayout({ name: "kbGlideSwellFbm", type: "float", inputs: [{ name: "p", type: "vec2" }] });

const gouacheToneFn = Fn(([x]: readonly [F]) => {
  const clamped = clamp(x, 0, 1);
  const stepped = clamped.sub(sin(clamped.mul(Math.PI * 2 * 6.5)).mul(0.028));
  return clamp(stepped, 0, 1);
}).setLayout({ name: "kbGlideGouacheTone", type: "float", inputs: [{ name: "x", type: "float" }] });

const vnoise = (p: V2): F => vnoiseFn(p);
const vfbm2 = (p: V2): F => vfbm2Fn(p);
const fbm2 = (p: V2): F => fbm2Fn(p);
const swellFbm = (p: V2): F => swellFbmFn(p);
const gouacheTone = (x: F): F => gouacheToneFn(x);

/** Everything the CPU updates per frame or layout. */
export function glidingUniforms() {
  const tuned = glidingTuning({});
  return {
    /** Cumulative world-space gliding scroll distance along flight heading. */
    scroll: uniform(0),
    /** Independent organic evolution phase for deep seabed shoals & caustics. */
    seabedPhase: uniform(0),
    /** Independent organic evolution phase for mid-water gouache swells & currents. */
    swellPhase: uniform(0),
    /** Independent organic evolution phase for surface chalky sea-foam ribbons & lace. */
    foamPhase: uniform(0),
    /** 1 on dark page, 0 on light page. */
    dark: uniform(1),
    /** Frame aspect ratio (width / height). */
    aspect: uniform(3.55),
    /** Hero composition anchor in frame units (width-agnostic, relative to content center). */
    anchor: uniform(new Vector2(0, 0)),
    /** Damped pointer dolly offset in frame units. */
    dolly: uniform(new Vector2(0, 0)),
    /** Seeded world origin offset so each load reveals a unique stretch of ocean. */
    origin: uniform(new Vector2(0, 0)),
    /** Seeded subtle warmth offset. */
    seedWarmth: uniform(0),
    /** Sun warmth knob [-1, 1]. */
    sunWarmth: uniform(tuned.sunWarmth),
    /** Sea foam knob [0, 2]. */
    foam: uniform(tuned.foam),
    /** Organic seafloor caustic dapples [0, 2]. */
    caustics: uniform(tuned.caustics),
    /** Inter-layer depth parallax multiplier [0, 2]. */
    parallax: uniform(tuned.parallax),
    /** Luminous anime sheen riding along sunlit wave-swell edges [0, 2]. */
    waveSheen: uniform(tuned.waveSheen),
    /** Sunlit diamond sea gleam across swell facets [0, 2]. */
    seaGleam: uniform(tuned.seaGleam),
    /** How much bottom organic gouache dissolve applies: 1 on page-head, 0 in full-bleed Studio. */
    bottomDissolve: uniform(1),
    /** Head text readability scrim (`gpu/text-scrim.ts`). */
    scrim: textScrim(),
  };
}
export type GlidingUniforms = ReturnType<typeof glidingUniforms>;

/** Multi-stop dark-mode gouache turquoise-to-marine palette matched to the reference frame. */
function darkOceanColor(tone: F, warmth: F): V3 {
  const abyss = rgb(3, 24, 48);
  const petrol = rgb(5, 52, 84);
  const deepTeal = rgb(7, 86, 114);
  const turquoise = rgb(12, 138, 158);
  const sunlitAqua = rgb(24, 188, 198);
  const shallowMint = rgb(66, 214, 216);

  const c = mix(abyss, petrol, smoothstep(0.0, 0.24, tone)).toVar();
  c.assign(mix(c, deepTeal, smoothstep(0.2, 0.48, tone)));
  c.assign(mix(c, turquoise, smoothstep(0.44, 0.7, tone)));
  c.assign(mix(c, sunlitAqua, smoothstep(0.66, 0.88, tone)));
  c.assign(mix(c, shallowMint, smoothstep(0.84, 1.0, tone)));

  const sunWeight = smoothstep(0.32, 0.95, tone);
  const warmShift = vec3(0.042, 0.032, -0.045).mul(warmth).mul(sunWeight);
  return max(c.add(warmShift), vec3(0.001, 0.005, 0.01));
}

/** Light-mode painterly cerulean-teal watercolor wash: retains deep teal pools so birds, shadow & hull separate cleanly. */
function lightOceanColor(tone: F, warmth: F, page: V3): V3 {
  const deepPool = rgb(44, 126, 152);
  const midTeal = rgb(94, 174, 194);
  const sunlitAqua = rgb(156, 214, 224);
  const paleWash = rgb(212, 238, 244);

  const c = mix(deepPool, midTeal, smoothstep(0.06, 0.42, tone)).toVar();
  c.assign(mix(c, sunlitAqua, smoothstep(0.36, 0.72, tone)));
  c.assign(mix(c, paleWash, smoothstep(0.68, 1.0, tone)));

  const warmShift = vec3(0.025, 0.02, -0.022)
    .mul(warmth)
    .mul(smoothstep(0.3, 0.95, tone));
  return clamp(
    c.add(warmShift).mul(page.mul(0.28).add(0.72)),
    vec3(0, 0, 0),
    vec3(0.996, 0.996, 0.996),
  );
}

/** World coordinates at depth parallax offset `depthShift` (-1 seabed, 0 mid-water, +1 surface foam). */
function layerWorld(u: GlidingUniforms, rel: V2, depthShift: number): V2 {
  const scrollMult = float(1).add(u.parallax.mul(depthShift * 0.28));
  const dollyMult = float(1).add(u.parallax.mul(depthShift * 0.38));
  const scrollDist = u.scroll.mul(scrollMult);
  const moved = rel.sub(u.dolly.mul(dollyMult));
  return moved
    .mul(2.55)
    .add(vec2(scrollDist.mul(HEADING_X), scrollDist.mul(HEADING_Y)))
    .add(u.origin);
}

interface WaterLayers {
  readonly seabedBp: V2;
  readonly midBp: V2;
  readonly foamBp: V2;
  readonly q: V2;
  readonly shoal: F;
  readonly swell: F;
  readonly brushDabA: F;
  readonly brushDabB: F;
  readonly pigmentGrain: F;
  readonly rawTone: F;
  readonly pooledTone: F;
}

/** Evaluate Layer 1 (deep seabed shoals) + Layer 2 (mid-water gouache swells & brushwork). */
function sampleWaterLayers(u: GlidingUniforms, p: V2): WaterLayers {
  const rel = p.sub(u.anchor).toVar();
  const seabedWp = layerWorld(u, rel, -1).toVar();
  const midWp = layerWorld(u, rel, 0).toVar();
  const foamWp = layerWorld(u, rel, 1);

  const seabedBp = align(seabedWp, BRUSH_COS, BRUSH_SIN).toVar();
  const midBp = align(midWp, BRUSH_COS, BRUSH_SIN).toVar();
  const foamBp = align(foamWp, BRUSH_COS, BRUSH_SIN).toVar();
  const cp = align(midWp, CROSS_COS, CROSS_SIN);

  // Layer 2 sweeping current warp (driven by `swellPhase`).
  const sp = u.swellPhase;
  const warpCoord = midBp.mul(vec2(0.38, 0.58));
  const q = vec2(
    fbm2(warpCoord.add(vec2(sp.mul(0.55), sp.mul(-0.32)))),
    fbm2(warpCoord.add(vec2(4.7, 2.3)).add(vec2(sp.mul(-0.42), sp.mul(0.5)))),
  )
    .sub(0.5)
    .toVar();

  // Layer 1 deep seabed sandbars & sunlit shallows (slower parallax, evolves on `seabedPhase`).
  // Strong sunlit shallow aqua toward upper-left, broad quiet deep petrol-marine toward right & lower-right.
  const bp1 = u.seabedPhase;
  const diag = rel.x.mul(-0.42).add(rel.y.mul(0.44)).add(0.46);
  const shoal = fbm2(
    seabedBp
      .mul(vec2(0.28, 0.52))
      .add(q.mul(0.85))
      .add(vec2(bp1.mul(0.42).add(1.4), bp1.mul(-0.28).sub(2.2))),
  ).toVar();

  // Layer 2 sculpted mid-water gouache wave swells & curved overlapping flat-brush dabs.
  const swellCoord = vec2(midBp.x.mul(0.62), midBp.y.mul(1.75))
    .add(q.mul(vec2(1.15, 1.55)))
    .add(vec2(sp.mul(0.22), sp.mul(-0.36)))
    .toVar();
  const swell = swellFbm(swellCoord).toVar();
  const waveRelief = clamp(
    swell.sub(swellFbm(swellCoord.add(vec2(-0.09, 0.15)))).mul(2.3),
    -0.34,
    0.34,
  );
  const brushDabA = vfbm2(
    vec2(midBp.x.mul(1.65), midBp.y.mul(6.8))
      .add(q.mul(vec2(1.8, 3.6)))
      .add(vec2(sp.mul(0.35).add(2.1), sp.mul(-0.22).sub(1.3))),
  ).toVar();
  const brushDabB = vfbm2(
    vec2(cp.x.mul(2.1), cp.y.mul(5.8))
      .add(q.mul(vec2(1.6, 3.1)))
      .add(vec2(sp.mul(-0.28).add(8.4), sp.mul(0.24).add(3.2))),
  );
  const pigmentGrain = vfbm2(midWp.mul(8.5).add(q.mul(3.2))).toVar();

  const rawTone = clamp(
    diag
      .mul(0.46)
      .add(shoal.mul(0.38))
      .add(swell.sub(0.5).mul(0.5))
      .add(waveRelief.mul(0.4))
      .add(brushDabA.sub(0.5).mul(0.22))
      .add(brushDabB.sub(0.5).mul(0.18))
      .add(pigmentGrain.sub(0.5).mul(0.12)),
    0,
    1,
  ).toVar();
  const tone = gouacheTone(rawTone);
  const troughEdge = smoothstep(0.26, 0.52, swell).mul(float(1).sub(smoothstep(0.52, 0.78, swell)));
  const pooledTone = clamp(tone.sub(troughEdge.mul(0.055)), 0, 1);

  return {
    seabedBp,
    midBp,
    foamBp,
    q,
    shoal,
    swell,
    brushDabA,
    brushDabB,
    pigmentGrain,
    rawTone,
    pooledTone,
  };
}

/** Layer 1 detail: organic warped cellular light dapples on shallow seabed (zero grid/net lines). */
function applyShallowCaustics(
  u: GlidingUniforms,
  f: WaterLayers,
  darkWater: V3,
  lightWater: V3,
): { readonly dark: V3; readonly light: V3 } {
  const bp1 = u.seabedPhase;
  const amount = clamp(u.caustics, 0, 2);
  const shoalPatch = smoothstep(0.48, 0.78, f.rawTone).mul(
    smoothstep(
      0.34,
      0.68,
      fbm2(f.seabedBp.mul(vec2(0.52, 0.72)).add(f.q.mul(1.2)).add(vec2(3.1, -1.7))),
    ),
  );
  // Two heavily domain-warped organic noise ridges at incommensurate scales -> painterly light dapples, no net.
  const warp = f.q.mul(3.4).add(vec2(f.swell.mul(1.6), f.brushDabA.mul(-1.4)));
  const cellA = float(1).sub(
    abs(
      vfbm2(
        f.seabedBp
          .mul(vec2(2.6, 4.1))
          .add(warp)
          .add(vec2(bp1.mul(0.55), bp1.mul(-0.38))),
      ).sub(0.5),
    ).mul(2.0),
  );
  const cellB = float(1).sub(
    abs(
      vfbm2(
        f.seabedBp
          .mul(vec2(4.3, 3.2))
          .add(warp.mul(1.3))
          .add(vec2(bp1.mul(-0.42).add(7.4), bp1.mul(0.46).sub(4.1))),
      ).sub(0.5),
    ).mul(2.0),
  );
  const dapple = smoothstep(0.62, 0.92, cellA.mul(0.58).add(cellB.mul(0.42)))
    .mul(shoalPatch)
    .mul(smoothstep(0.2, 0.72, f.pigmentGrain))
    .mul(amount);
  return {
    dark: darkWater.add(rgb(82, 224, 226).mul(dapple.mul(0.14))),
    light: mix(lightWater, rgb(228, 249, 252), clamp(dapple.mul(0.28), 0, 0.4)),
  };
}

/** A traveling dab on the sunward lip of the same curved crest that carries the foam. */
function computeWaveEdgeSheen(
  u: GlidingUniforms,
  f: WaterLayers,
  crestDistance: F,
  presence: F,
): F {
  const edgeDistance = crestDistance.sub(0.014);
  const edge = float(1).sub(
    smoothstep(0.003, fwidth(crestDistance).min(0.025).add(0.005), abs(edgeDistance)),
  );
  const along = f.foamBp.x.mul(1.6).add(f.q.x).sub(u.foamPhase.mul(3.4));
  const stroke = float(1).sub(smoothstep(0.058, 0.115, abs(fract(along).sub(0.5))));
  return edge
    .mul(stroke)
    .mul(smoothstep(0.18, 0.56, presence))
    .mul(u.waveSheen);
}

/** Crisp occasional sunlit anime diamond sea gleam flashing across bright ocean swell facets. */
function computeSeaGleam(u: GlidingUniforms, f: WaterLayers, quietFoam: F): F {
  const gleamCoord = f.midBp
    .mul(vec2(14.5, 28.0))
    .add(f.q.mul(5.2))
    .add(vec2(u.dolly.x.mul(18.0), u.dolly.y.mul(18.0)))
    .add(vec2(u.swellPhase.mul(1.8), u.swellPhase.mul(-1.3)));
  const gleamSpark = pow(vnoise(gleamCoord), 11.0);
  const gleamAngle = smoothstep(0.56, 0.86, f.swell).mul(smoothstep(0.44, 0.84, f.rawTone));
  const gleamPulse = sin(f.midBp.x.mul(2.1).add(f.midBp.y.mul(3.4)).sub(u.swellPhase.mul(2.6)))
    .mul(0.5)
    .add(0.5);
  return gleamSpark
    .mul(gleamAngle)
    .mul(smoothstep(0.4, 0.9, gleamPulse))
    .mul(quietFoam)
    .mul(u.seaGleam);
}

/** Layer 3 detail: sparse, organic branching sea-foam fragments leaving broad quiet stretches of petrol-blue water. */
function applySeaFoam(
  u: GlidingUniforms,
  f: WaterLayers,
  water: { readonly dark: V3; readonly light: V3 },
  warmth: F,
  quietFoam: F,
): { readonly dark: V3; readonly light: V3 } {
  const fp = u.foamPhase;
  const foamAmount = clamp(u.foam, 0, 2);
  const sCurve = f.q.y
    .mul(2.1)
    .add(f.q.x.mul(1.1))
    .add(f.swell.sub(0.5).mul(1.55))
    .add(f.brushDabB.sub(0.5).mul(0.52));
  // Lower spatial frequency & heavier domain warp so crests never march in uniform parallel stripes.
  const dMain = fract(f.foamBp.y.mul(1.38).add(f.foamBp.x.mul(0.14)).add(sCurve).sub(fp.mul(0.24)))
    .sub(0.5)
    .toVar();
  const absMain = abs(dMain);

  // Broad quiet-water openings: breaks long lanes into short, organic branching fragments
  // and keeps the deeper right-hand ocean calm so WB-027, its shadow, and the HUD breathe.
  const calmPatches = smoothstep(
    0.34,
    0.68,
    fbm2(
      vec2(f.foamBp.x.mul(0.36), f.foamBp.y.mul(0.56))
        .add(f.q.mul(1.1))
        .add(vec2(fp.mul(0.16).add(3.2), fp.mul(-0.12).add(7.1))),
    ),
  );
  const fragmentMask = smoothstep(
    0.26,
    0.66,
    vfbm2(
      vec2(f.foamBp.x.mul(0.95), f.foamBp.y.mul(1.35))
        .add(f.q.mul(1.25))
        .add(vec2(fp.mul(0.22).add(5.4), fp.mul(-0.18).add(2.7))),
    ),
  );
  // Stronger sunlit foam fragments on the bright upper-left shallows; quiet sparse wisps in deeper petrol zones.
  const sunlitBias = mix(float(0.42), float(1.45), smoothstep(0.24, 0.8, f.rawTone));
  const presence = clamp(calmPatches.mul(fragmentMask).mul(sunlitBias), 0, 1).toVar();

  const webA = float(1).sub(
    abs(
      vnoise(
        f.foamBp
          .mul(vec2(10.5, 20.0))
          .add(f.q.mul(4.8))
          .add(vec2(fp.mul(0.7), fp.mul(-0.45))),
      ).sub(0.5),
    ).mul(2.0),
  );
  const chalkTooth = vnoise(f.foamBp.mul(vec2(38.0, 74.0)).add(f.q.mul(3.6))).toVar();
  const laceWeb = smoothstep(0.56, 0.86, webA.mul(0.68).add(chalkTooth.sub(0.5).mul(0.42))).toVar();
  const drySpeck = smoothstep(0.28, 0.78, f.pigmentGrain.mul(0.55).add(chalkTooth.mul(0.45)));

  const spineW = mix(float(0.004), float(0.017), presence).mul(foamAmount.mul(0.42).add(0.52));
  const edgeJagged = webA.sub(0.5).mul(0.028).add(chalkTooth.sub(0.5).mul(0.022));
  const foamCore = float(1)
    .sub(smoothstep(spineW.mul(0.34), spineW.add(0.009), absMain.add(edgeJagged)))
    .mul(smoothstep(0.22, 0.56, presence))
    .mul(smoothstep(0.24, 0.68, webA.mul(0.52).add(chalkTooth.mul(0.48)).add(0.12)))
    .mul(min(foamAmount, 1.35));

  const apronDist = mix(absMain.mul(1.85), absMain, smoothstep(-0.02, 0.04, dMain));
  const apronW = mix(float(0.028), float(0.12), presence).mul(foamAmount.mul(0.45).add(0.5));
  const totalLace = float(1)
    .sub(smoothstep(apronW.mul(0.2), apronW.add(0.024), apronDist.add(edgeJagged.mul(1.45))))
    .mul(presence)
    .mul(laceWeb)
    .mul(min(foamAmount, 1.3));

  const dryBrush = smoothstep(0.58, 0.84, f.brushDabA)
    .mul(smoothstep(0.34, 0.74, f.swell))
    .mul(drySpeck)
    .mul(0.22);
  const foamWash = float(1)
    .sub(smoothstep(0.024, 0.14, apronDist.add(f.brushDabA.sub(0.5).mul(0.045))))
    .mul(presence)
    .mul(drySpeck)
    .mul(min(foamAmount, 1.25));
  const darkFoamCore = max(
    rgb(212, 234, 230).add(vec3(0.032, 0.02, -0.022).mul(warmth)),
    vec3(0.54, 0.72, 0.72),
  );
  const seaGleam = computeSeaGleam(u, f, quietFoam);
  const waveSheen = computeWaveEdgeSheen(u, f, dMain, presence).mul(quietFoam);
  const gleamCol = rgb(255, 250, 232).add(vec3(0.05, 0.03, -0.04).mul(warmth));
  const sheenCol = rgb(226, 252, 255).add(vec3(0.05, 0.03, -0.02).mul(warmth));
  const darkWash = clamp(foamWash.mul(0.22).add(dryBrush), 0, 0.4).mul(quietFoam);
  const lightWash = clamp(foamWash.mul(0.3).add(dryBrush.mul(0.8)), 0, 0.45).mul(quietFoam);
  const laceAmt = totalLace.mul(0.68).mul(quietFoam);
  const coreAmt = foamCore.mul(0.86).mul(quietFoam);
  const dark = mix(
    mix(mix(water.dark, rgb(64, 178, 190), darkWash), rgb(156, 218, 216), laceAmt),
    darkFoamCore,
    coreAmt,
  )
    .add(sheenCol.mul(waveSheen.mul(0.95)))
    .add(gleamCol.mul(seaGleam.mul(1.05)));
  const light = mix(
    mix(mix(water.light, rgb(196, 234, 240), lightWash), rgb(232, 247, 250), laceAmt),
    rgb(248, 253, 254),
    coreAmt,
  )
    .add(vec3(1, 0.998, 0.985).mul(waveSheen.mul(0.72)))
    .add(vec3(1, 0.995, 0.97).mul(seaGleam.mul(0.72)));
  return { dark, light };
}

/**
 * The Vast Painterly Gouache Ocean frame (`scene.backgroundNode`):
 * full-bleed across width and top chrome, with an undulating organic gouache
 * dissolve along the bottom edge so page content meets the ocean cleanly.
 */
export function oceanFrame(u: GlidingUniforms, { page, paint }: Grounds): V3 {
  return Fn(() => {
    const at = vec2(screenUV.x, float(1).sub(screenUV.y)).toVar();
    const p = vec2(at.x.sub(0.5).mul(u.aspect), at.y.sub(0.5)).toVar();
    // Early-out only below the bottom dissolve margin when active (page-head); Studio is full-bleed.
    const bottomGuard = mix(float(1), smoothstep(0.008, 0.04, at.y), u.bottomDissolve).toVar();
    const outLinear = page.toVar();

    If(bottomGuard.greaterThan(0.001), () => {
      const fields = sampleWaterLayers(u, p);
      const warmth = u.sunWarmth.add(u.seedWarmth);
      const baseDark = darkOceanColor(fields.pooledTone, warmth);
      const baseLight = lightOceanColor(fields.pooledTone, warmth, page);

      const withCaustics = applyShallowCaustics(u, fields, baseDark, baseLight);
      // Only quiet foam gently under page-head title rows (never in full-bleed Studio, and never a white strip).
      const underText = u.scrim.under(at).mul(u.bottomDissolve).toVar();
      const withFoam = applySeaFoam(
        u,
        fields,
        withCaustics,
        warmth,
        float(1).sub(underText.mul(0.55)),
      );

      // Subtle dark-only title quietening on page-head; Light mode stays completely strip-free.
      const scrimmedDark = mix(withFoam.dark, withFoam.dark.mul(0.76), underText.mul(0.35));
      const scrimmedLight = withFoam.light;

      // Subtle ocean pigment tooth; main unified watercolor paper grain is applied in `painterly-post.ts`.
      const paperTooth = vnoise(p.mul(230))
        .mul(0.58)
        .add(vnoise(p.mul(480).add(vec2(17.3, 9.1))).mul(0.42))
        .sub(0.5);
      const texturedDark = scrimmedDark.add(vec3(paperTooth, paperTooth, paperTooth).mul(0.008));
      const texturedLight = scrimmedLight.add(vec3(paperTooth, paperTooth, paperTooth).mul(0.006));

      // Vast ocean: full-bleed left, right, and top; organic ragged gouache-wash dissolve along the bottom only.
      const waveOffset = fields.shoal
        .sub(0.5)
        .mul(0.16)
        .add(fields.brushDabA.sub(0.5).mul(0.09))
        .add(fields.pigmentGrain.sub(0.5).mul(0.05));
      const bottomEdge = smoothstep(0.03, 0.34, at.y.add(waveOffset));
      const mask = mix(float(1), pow(bottomEdge, 1.15).mul(bottomGuard), u.bottomDissolve);

      const gradedDark = mix(
        page,
        darkGrade(clamp(texturedDark, vec3(0, 0, 0), vec3(0.992, 0.992, 0.992)), page),
        mask,
      );
      const gradedLight = mix(page, lightWaterWithPaper(texturedLight, page), mask);
      outLinear.assign(
        clamp(mix(gradedLight, gradedDark, u.dark), vec3(0, 0, 0), vec3(0.999, 0.999, 0.999)),
      );
    });

    return paint(outLinear);
  })();
}

/** Keep light-mode watercolor wash softly grounded to page white so paper grain never clips harsh. */
function lightWaterWithPaper(water: V3, page: V3): V3 {
  return clamp(mix(water, page, float(0.04)), vec3(0, 0, 0), vec3(0.998, 0.998, 0.998));
}
