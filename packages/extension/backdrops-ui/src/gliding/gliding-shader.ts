/**
 * Gliding's Painterly Gouache Ocean shader (Step 1): an aerial top-down view
 * of a sunlit tropical-to-marine ocean painted in the hand-illustrated gouache
 * aesthetic of anime film backgrounds, rather than mirror PBR water.
 *
 * Layered construction (single pass, world-space anchored to frame height):
 * 1. Macro sunlit-to-deep sweep (`waterSample`): luminous Caribbean turquoise
 *    in the upper-left sweeping diagonally into velvety Prussian marine teal,
 *    sculpted by curved domain-warped ocean currents and sunlit/shaded wave faces.
 * 2. Curved painterly gouache brushwork: overlapping multi-angle flat-brush
 *    washes that bend along the swells, with soft tonal banding, wet-edge
 *    pigment pooling, and matte gouache granulation.
 * 3. Localized submerged shallow-water caustic cross-hatching (`applyShallowCaustics`):
 *    fine oblique hand-etched teal ripple lines visible in sunlit shallows.
 * 4. Sinuous chalky sea-foam ribbons with true lacy bubble-webbing (`applySeaFoam`):
 *    open S-curved diagonal wave-crest lines combining a dry-brushed matte
 *    off-white crest spine with netted foam lace and feathery aqua underwashes.
 * 5. Matte cold-press paper tooth and undulating brush-feathered ground-only
 *    dissolve (`gpu/dissolve.ts`) that vanishes cleanly into dark & light pages.
 */
import {
  Fn,
  If,
  abs,
  clamp,
  float,
  floor,
  fract,
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
import { dissolve, dissolveUniforms } from "../gpu/dissolve";
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

/** Convert sRGB [0..1] channel to linear light. */
const lin = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

/** Build a constant linear vec3 from sRGB [0..255] bytes. */
const rgb = (r: number, g: number, b: number): V3 => vec3(lin(r / 255), lin(g / 255), lin(b / 255));

/** Rotate 2D coordinates into a frame aligned with (cosA, sinA). */
const align = (p: V2, cosA: number, sinA: number): V2 =>
  vec2(p.x.mul(cosA).add(p.y.mul(sinA)), p.y.mul(cosA).sub(p.x.mul(sinA)));

/** Octave rotation/scale so octaves never align on a grid. */
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

/** Lean 2-octave value fBm for curved brushwork, cellular foam lace and gouache breakup. */
const vfbm2Fn = Fn(([start]: readonly [V2]) => {
  const n0 = vnoiseFn(start);
  const n1 = vnoiseFn(turn(start).add(vec2(5.3, 2.7)));
  return n0.mul(0.64).add(n1.mul(0.36));
}).setLayout({ name: "kbGlideVfbm2", type: "float", inputs: [{ name: "p", type: "vec2" }] });

/** 2-octave gradient fBm for smooth, sinuous macro ocean currents and S-curve warps. */
const fbm2Fn = Fn(([start]: readonly [V2]) => {
  const n0 = gnoise(start);
  const n1 = gnoise(turn(start).add(vec2(3.7, 1.9)));
  return n0.mul(0.66).add(n1.mul(0.34));
}).setLayout({ name: "kbGlideFbm2", type: "float", inputs: [{ name: "p", type: "vec2" }] });

/** 3-octave mixed gradient/value fBm for rich medium-scale sculpted wave swells. */
const swellFbmFn = Fn(([start]: readonly [V2]) => {
  const p1 = turn(start).add(vec2(2.3, 4.1)).toVar();
  const p2 = turn(p1).add(vec2(5.1, 1.7));
  return gnoise(start).mul(0.54).add(vnoiseFn(p1).mul(0.3)).add(vnoiseFn(p2).mul(0.16));
}).setLayout({ name: "kbGlideSwellFbm", type: "float", inputs: [{ name: "p", type: "vec2" }] });

/** Soft gouache value stepping: clusters tones into layered hand-painted washes. */
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
    /** Slow organic phase evolution for swells, foam breakup and caustics. */
    phase: uniform(0),
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
    /** Organic ground-only dissolve reach (`gpu/dissolve.ts`). */
    reach: dissolveUniforms(),
    /** Head text readability scrim (`gpu/text-scrim.ts`). */
    scrim: textScrim(),
  };
}
export type GlidingUniforms = ReturnType<typeof glidingUniforms>;

/** Multi-stop dark-mode gouache turquoise-to-marine palette matched to the reference frame. */
function darkOceanColor(tone: F, warmth: F): V3 {
  const abyss = rgb(4, 30, 56);
  const marine = rgb(7, 64, 98);
  const deepTeal = rgb(10, 98, 124);
  const turquoise = rgb(14, 148, 166);
  const sunlitAqua = rgb(26, 194, 204);
  const shallowMint = rgb(74, 218, 220);

  const c = mix(abyss, marine, smoothstep(0.0, 0.2, tone)).toVar();
  c.assign(mix(c, deepTeal, smoothstep(0.16, 0.42, tone)));
  c.assign(mix(c, turquoise, smoothstep(0.38, 0.64, tone)));
  c.assign(mix(c, sunlitAqua, smoothstep(0.6, 0.84, tone)));
  c.assign(mix(c, shallowMint, smoothstep(0.8, 1.0, tone)));

  const sunWeight = smoothstep(0.28, 0.95, tone);
  const warmShift = vec3(0.042, 0.032, -0.045).mul(warmth).mul(sunWeight);
  return max(c.add(warmShift), vec3(0.001, 0.005, 0.01));
}

/** Light-mode pastel cerulean watercolor wash, authored to dissolve seamlessly into paper white. */
function lightOceanColor(tone: F, warmth: F, page: V3): V3 {
  const deepVein = rgb(84, 162, 182);
  const midWash = rgb(138, 202, 216);
  const paleAqua = rgb(192, 232, 238);
  const paperAqua = rgb(232, 247, 250);

  const c = mix(deepVein, midWash, smoothstep(0.05, 0.36, tone)).toVar();
  c.assign(mix(c, paleAqua, smoothstep(0.32, 0.68, tone)));
  c.assign(mix(c, paperAqua, smoothstep(0.65, 1.0, tone)));

  const warmShift = vec3(0.025, 0.02, -0.022)
    .mul(warmth)
    .mul(smoothstep(0.3, 0.95, tone));
  return clamp(
    c.add(warmShift).mul(page.mul(0.35).add(0.65)),
    vec3(0, 0, 0),
    vec3(0.998, 0.998, 0.998),
  );
}

/** Shared ocean fields evaluated once per pixel and reused across caustics, foam and dissolve. */
interface OceanFields {
  readonly bp: V2;
  readonly q: V2;
  readonly shoal: F;
  readonly swell: F;
  readonly brushDabA: F;
  readonly brushDabB: F;
  readonly pigmentGrain: F;
  readonly rawTone: F;
  readonly pooledTone: F;
}

/** Sample macro currents, sculpted wave swells, curved flat-brush washes and gouache tonal value. */
function sampleOceanFields(u: GlidingUniforms, p: V2): OceanFields {
  const ph = u.phase;
  const rel = p.sub(u.anchor).sub(u.dolly).toVar();
  const wp = rel
    .mul(2.55)
    .add(vec2(u.scroll.mul(HEADING_X), u.scroll.mul(HEADING_Y)))
    .add(u.origin)
    .toVar();
  const bp = align(wp, BRUSH_COS, BRUSH_SIN).toVar();
  const cp = align(wp, CROSS_COS, CROSS_SIN);

  const warpCoord = bp.mul(vec2(0.38, 0.58));
  const q = vec2(
    fbm2(warpCoord.add(vec2(ph.mul(0.45), ph.mul(-0.26)))),
    fbm2(warpCoord.add(vec2(4.7, 2.3)).add(vec2(ph.mul(-0.34), ph.mul(0.42)))),
  )
    .sub(0.5)
    .toVar();

  const diag = rel.x.mul(-0.32).add(rel.y.mul(0.48)).add(0.48);
  const shoal = fbm2(bp.mul(vec2(0.28, 0.52)).add(q.mul(1.15)).add(vec2(1.4, -2.2))).toVar();

  const swellCoord = vec2(bp.x.mul(0.62), bp.y.mul(1.75))
    .add(q.mul(vec2(1.15, 1.55)))
    .add(vec2(ph.mul(0.14), ph.mul(-0.24)))
    .toVar();
  const swell = swellFbm(swellCoord).toVar();
  const waveRelief = clamp(
    swell.sub(swellFbm(swellCoord.add(vec2(-0.09, 0.15)))).mul(2.3),
    -0.34,
    0.34,
  );

  const brushDabA = vfbm2(
    vec2(bp.x.mul(1.65), bp.y.mul(6.8))
      .add(q.mul(vec2(1.8, 3.6)))
      .add(vec2(2.1, -1.3)),
  ).toVar();
  const brushDabB = vfbm2(
    vec2(cp.x.mul(2.1), cp.y.mul(5.8))
      .add(q.mul(vec2(1.6, 3.1)))
      .add(vec2(8.4, 3.2)),
  );
  const pigmentGrain = vfbm2(wp.mul(8.5).add(q.mul(3.2))).toVar();

  const rawTone = clamp(
    diag
      .mul(0.5)
      .add(shoal.mul(0.36))
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

  return { bp, q, shoal, swell, brushDabA, brushDabB, pigmentGrain, rawTone, pooledTone };
}

/** Layer localized oblique submerged caustic cross-hatching into sunlit turquoise shallows. */
function applyShallowCaustics(
  u: GlidingUniforms,
  f: OceanFields,
  darkWater: V3,
  lightWater: V3,
): { readonly dark: V3; readonly light: V3 } {
  const ph = u.phase;
  const hatchPatch = smoothstep(0.46, 0.74, f.rawTone).mul(
    smoothstep(
      0.32,
      0.64,
      vfbm2(f.bp.mul(vec2(0.75, 1.05)).add(f.q.mul(1.0)).add(vec2(3.1, -1.7))),
    ),
  );
  const hatchWarp = f.q.mul(5.8).add(vec2(f.swell.mul(2.1), f.brushDabB.mul(-1.8)));
  const hLineA = pow(
    float(1).sub(abs(sin(f.bp.x.mul(6.5).add(f.bp.y.mul(30.0)).add(hatchWarp.x).add(ph.mul(1.0))))),
    3.4,
  );
  const hLineB = pow(
    float(1).sub(
      abs(sin(f.bp.x.mul(23.0).add(f.bp.y.mul(14.0)).add(hatchWarp.y).sub(ph.mul(0.8)))),
    ),
    3.8,
  );
  const hatchLines = clamp(hLineA.mul(0.88).add(hLineB.mul(0.7)), 0, 1)
    .mul(hatchPatch)
    .mul(smoothstep(0.18, 0.7, f.pigmentGrain));
  return {
    dark: darkWater
      .mul(float(1).sub(hatchLines.mul(0.42)))
      .add(rgb(74, 218, 222).mul(hLineA.mul(hatchPatch).mul(0.08))),
    light: mix(lightWater, rgb(78, 166, 186), hatchLines.mul(0.34)),
  };
}

/** Layer sinuous chalky sea-foam ribbons, netted cellular bubble lace and feathery aqua trails. */
function applySeaFoam(
  u: GlidingUniforms,
  f: OceanFields,
  water: { readonly dark: V3; readonly light: V3 },
  warmth: F,
  quietFoam: F,
): { readonly dark: V3; readonly light: V3 } {
  const ph = u.phase;
  const foamAmount = clamp(u.foam, 0, 2);
  const sCurve = f.q.y
    .mul(1.55)
    .add(f.q.x.mul(0.65))
    .add(f.swell.sub(0.5).mul(1.2))
    .add(f.brushDabB.sub(0.5).mul(0.38));
  const dMain = fract(f.bp.y.mul(2.15).add(f.bp.x.mul(0.09)).add(sCurve).sub(ph.mul(0.15)))
    .sub(0.5)
    .toVar();
  const absMain = abs(dMain);
  const dSub = fract(
    f.bp.y
      .mul(3.15)
      .sub(f.bp.x.mul(0.26))
      .add(f.q.x.mul(1.4))
      .add(f.q.y.mul(0.65))
      .add(f.brushDabA.sub(0.5).mul(0.75))
      .add(ph.mul(0.1)),
  ).sub(0.5);
  const absSub = abs(dSub);

  const ribbonBreak = vfbm2(
    vec2(f.bp.x.mul(0.58), f.bp.y.mul(1.1)).add(f.q.mul(1.0)).add(vec2(5.4, 2.7)),
  );
  const sunlitBias = mix(float(0.6), float(1.38), smoothstep(0.16, 0.78, f.rawTone));
  const presence = smoothstep(0.24, 0.7, ribbonBreak.mul(sunlitBias)).toVar();

  // Inverted ridge webbing: 1 along crisp foam filaments, 0 inside dark-water bubbles.
  const webA = float(1).sub(
    abs(vnoise(f.bp.mul(vec2(11.5, 22.0)).add(f.q.mul(4.5))).sub(0.5)).mul(2.0),
  );
  const webB = float(1).sub(
    abs(vnoise(f.bp.mul(vec2(24.0, 46.0)).add(f.q.mul(7.5)).add(vec2(4.7, 9.3))).sub(0.5)).mul(2.0),
  );
  const chalkTooth = vnoise(f.bp.mul(vec2(48.0, 92.0)).add(f.q.mul(4.0))).toVar();
  const laceWeb = smoothstep(
    0.54,
    0.85,
    webA.mul(0.62).add(webB.mul(0.38)).add(chalkTooth.sub(0.5).mul(0.36)),
  ).toVar();
  const drySpeck = smoothstep(0.24, 0.76, f.pigmentGrain.mul(0.55).add(chalkTooth.mul(0.45)));

  const spineW = mix(float(0.005), float(0.022), presence).mul(foamAmount.mul(0.45).add(0.55));
  const edgeJagged = webB.sub(0.5).mul(0.024).add(chalkTooth.sub(0.5).mul(0.02));
  const mainCore = float(1)
    .sub(smoothstep(spineW.mul(0.38), spineW.add(0.009), absMain.add(edgeJagged)))
    .mul(smoothstep(0.16, 0.48, presence))
    .mul(smoothstep(0.22, 0.64, webA.mul(0.52).add(chalkTooth.mul(0.48)).add(0.14)));

  const apronDist = mix(absMain.mul(1.75), absMain, smoothstep(-0.02, 0.04, dMain));
  const apronW = mix(float(0.035), float(0.145), presence).mul(foamAmount.mul(0.45).add(0.55));
  const foamLace = float(1)
    .sub(smoothstep(apronW.mul(0.18), apronW.add(0.025), apronDist.add(edgeJagged.mul(1.4))))
    .mul(presence)
    .mul(laceWeb)
    .mul(min(foamAmount, 1.35));

  const subPresence = smoothstep(
    0.34,
    0.74,
    vfbm2(vec2(f.bp.x.mul(0.85), f.bp.y.mul(1.45)).add(f.q.mul(1.1)).add(vec2(14.2, 6.8))).mul(
      sunlitBias,
    ),
  );
  const subW = mix(float(0.004), float(0.016), subPresence).mul(foamAmount.mul(0.4).add(0.6));
  const subCore = float(1)
    .sub(smoothstep(subW.mul(0.35), subW.add(0.008), absSub.add(edgeJagged.mul(0.9))))
    .mul(subPresence)
    .mul(smoothstep(0.22, 0.65, chalkTooth.add(0.2)));
  const subApron = mix(absSub.mul(1.6), absSub, smoothstep(-0.02, 0.04, dSub));
  const subLace = float(1)
    .sub(smoothstep(0.014, 0.095, subApron.add(edgeJagged)))
    .mul(subPresence)
    .mul(laceWeb)
    .mul(0.82);

  const foamWash = float(1)
    .sub(smoothstep(0.03, 0.18, apronDist.add(f.brushDabA.sub(0.5).mul(0.05))))
    .mul(presence)
    .mul(drySpeck)
    .mul(min(foamAmount, 1.3));
  const totalLace = clamp(max(foamLace, subLace), 0, 1);
  const foamCore = clamp(max(mainCore, subCore.mul(0.86)), 0, 1).mul(min(foamAmount, 1.35));

  const darkFoamCore = max(
    rgb(218, 238, 234).add(vec3(0.032, 0.02, -0.022).mul(warmth)),
    vec3(0.56, 0.74, 0.74),
  );
  const dark = mix(
    mix(
      mix(water.dark, rgb(98, 204, 210), foamWash.mul(0.24).mul(quietFoam)),
      rgb(174, 228, 224),
      totalLace.mul(0.76).mul(quietFoam),
    ),
    darkFoamCore,
    foamCore.mul(0.9).mul(quietFoam),
  );
  const light = mix(
    mix(
      mix(water.light, rgb(222, 246, 249), foamWash.mul(0.36).mul(quietFoam)),
      rgb(242, 252, 253),
      totalLace.mul(0.76).mul(quietFoam),
    ),
    rgb(252, 255, 255),
    foamCore.mul(0.92).mul(quietFoam),
  );
  return { dark, light };
}

/**
 * The Painterly Gouache Ocean frame (`scene.backgroundNode`):
 * infinite width-agnostic world-space ocean dissolving organically into the page ground.
 */
export function oceanFrame(u: GlidingUniforms, { page, paint }: Grounds): V3 {
  return Fn(() => {
    const at = vec2(screenUV.x, float(1).sub(screenUV.y)).toVar();
    const p = vec2(at.x.sub(0.5).mul(u.aspect), at.y.sub(0.5)).toVar();
    const rawMask = dissolve(u.reach, vec2(p.x, p.y.sub(0.02)), u.phase.mul(0.06)).toVar();
    const outLinear = page.toVar();

    If(rawMask.greaterThan(0.001), () => {
      const fields = sampleOceanFields(u, p);
      const warmth = u.sunWarmth.add(u.seedWarmth);
      const baseDark = darkOceanColor(fields.pooledTone, warmth);
      const baseLight = lightOceanColor(fields.pooledTone, warmth, page);

      const withCaustics = applyShallowCaustics(u, fields, baseDark, baseLight);
      const underText = u.scrim.under(at).toVar();
      const withFoam = applySeaFoam(
        u,
        fields,
        withCaustics,
        warmth,
        float(1).sub(underText.mul(0.78)),
      );

      // Gentle local scrim under title text so glyphs read effortlessly on both dark and light pages.
      const scrimmedDark = mix(withFoam.dark, withFoam.dark.mul(0.64), underText.mul(0.55));
      const scrimmedLight = mix(withFoam.light, page, underText.mul(0.44));

      // Stationary cold-press gouache paper tooth (isotropic, zero lattice at 2× DPR, strictly on artwork).
      const paperTooth = vnoise(p.mul(230))
        .mul(0.58)
        .add(vnoise(p.mul(480).add(vec2(17.3, 9.1))).mul(0.42))
        .sub(0.5);
      const texturedDark = scrimmedDark.add(vec3(paperTooth, paperTooth, paperTooth).mul(0.03));
      const texturedLight = scrimmedLight.add(vec3(paperTooth, paperTooth, paperTooth).mul(0.02));

      // Undulating painterly gouache dissolve boundary (reuses `shoal` for zero extra fbm2 cost).
      const edgeBand = rawMask.mul(float(1).sub(rawMask)).mul(4);
      const edgeBreak = fields.shoal
        .sub(0.5)
        .mul(0.38)
        .add(fields.brushDabA.sub(0.5).mul(0.28))
        .add(fields.pigmentGrain.sub(0.5).mul(0.18));
      const brushMask = clamp(rawMask.add(edgeBreak.mul(edgeBand)), 0, 1);
      const mask = pow(smoothstep(0.02, 0.96, brushMask), 1.25).mul(smoothstep(0.0, 0.04, rawMask));

      const gradedDark = mix(
        page,
        darkGrade(clamp(texturedDark, vec3(0, 0, 0), vec3(0.992, 0.992, 0.992)), page),
        mask,
      );
      const gradedLight = mix(page, texturedLight, mask);
      outLinear.assign(
        clamp(mix(gradedLight, gradedDark, u.dark), vec3(0, 0, 0), vec3(0.999, 0.999, 0.999)),
      );
    });

    return paint(outLinear);
  })();
}
