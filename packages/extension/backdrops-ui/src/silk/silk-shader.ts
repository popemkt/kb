/**
 * The Silk backdrop's shaders (T1): silk ribbons in three depths on a stage
 * that opens onto a faint cosmos.
 *
 * - **The ribbons** are solved analytically per pixel: each is a twisted
 *   strip seen orthographically, so a pixel finds its across-coordinate and
 *   its exact normal; there are no meshes, and the only edge is filtered,
 *   widened per layer for depth of field (`coc`, in pixels of a 720-pixel
 *   frame). BG ribbons are thin and soft in the haze, MG is the in-focus
 *   hero (a double-faced satin and a sheer organza), FG two large defocused
 *   edges slope into the right-hand corners and never reach the title.
 * - **The material**: anisotropic GGX (smooth along the fibre, rough
 *   across it: silk's stretched sheen), thin-film interference on the
 *   specular (Belcour and Barla 2017, after the Khronos glTF reference),
 *   wrapped diffuse, a grazing sheen, transmission for sheer silk, and a
 *   woven warp that resolves only at close range and in focus.
 * - **The light**: a key spot, a cool back gel, and a strip light that
 *   sweeps across, reaching each layer in turn and shadowed by every nearer
 *   ribbon. The hero shades and occludes the layers behind it and casts a
 *   coloured shadow and a caustic on the backdrop.
 * - **The backdrop**: on a dark page a velvet curtain thinning into space
 *   (gas, a galactic band with its dust lane, sparse stars, a few of which
 *   twinkle), haze in the beam; on a light page the paper itself, a pastel
 *   breath of gas. Dust in three depths takes the colour of the light that
 *   reaches it.
 *
 * Everything is drawn offscreen at a share of the frame's pixels
 * (`silkFragment`); the frame only shows it in the page's terms (`silkFrame`).
 */
import {
  Fn,
  If,
  abs,
  clamp,
  cos,
  cross,
  dot,
  exp,
  float,
  fract,
  int,
  max,
  min,
  mix,
  normalize,
  pow,
  screenUV,
  select,
  sin,
  smoothstep,
  sqrt,
  texture,
  uniform,
  uniformArray,
  uv,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import { type DataTexture, Vector2, Vector4 } from "three/webgpu";
import type { OffscreenInputs, PictureSampler, TslNode } from "@kb/scene-gpu";
import type { Grounds } from "../gpu/gpu-scene";
import { darkGrade } from "../gpu/dark-grade";
import { textScrim } from "../gpu/text-scrim";
import { fbm4 } from "../gpu/noise";
import {
  REFERENCE_HEIGHT,
  asFloat,
  byPage,
  byPage3,
  cosmosAt,
  cosmosFields,
  dustAt,
  one,
  paperAt,
  spotPool,
  velvetAt,
  type B,
  type F,
  type V2,
  type V3,
} from "./silk-stage";

type I = TslNode<"int">;
type V4 = TslNode<"vec4">;

export const RIBBONS = 7;
export const PUFFS = 6;
/** The wake strip's samples along each ribbon (x from -2.4 to 2.4). */
export const WAKE_SAMPLES = 512;

const PI = Math.PI;
/** Where the hero sits in the ribbon order (it shades and occludes what is behind it). */
const HERO = [3, 4] as const;

const vectors = () => Array.from({ length: RIBBONS }, () => new Vector4());
const ribbonArray = (of: Vector4[]) => uniformArray<"vec4">(of, "vec4");

/** Everything the CPU sets. Per ribbon: geo1 y0 a1 f1 a2, geo2 f2 phase width twist, geo3 depth sheer speed coc, geo4 tilt. */
export function silkUniforms() {
  /** The per-ribbon values the CPU writes; the arrays below read these very objects. */
  const ribbon = {
    geo1: vectors(),
    geo2: vectors(),
    geo3: vectors(),
    geo4: vectors(),
    front: vectors(),
    back: vectors(),
  };
  return {
    ribbon,
    time: uniform(0),
    /** The ribbons' own clock (it slows while the owner types). */
    twist: uniform(0),
    dark: uniform(1),
    calm: uniform(0),
    sweep: uniform(0),
    /** The layers' parallax, in frame units: the pointer, eased, or a slow idle drift. */
    parallax: uniform(new Vector2()),
    aspect: uniform(2),
    /** How far the ribbons rise in a narrow frame, where the text crosses it (frame heights). */
    lift: uniform(0),
    /** The head's text block: the cosmos keeps clear of it, and the frame lays a scrim there. */
    scrim: textScrim(),
    /** The frame region the cosmos pass covers: x0, y0, x1, y1. */
    cosmosWindow: uniform(new Vector4(-1, -0.56, 1, 0.56)),
    geo1: ribbonArray(ribbon.geo1),
    geo2: ribbonArray(ribbon.geo2),
    geo3: ribbonArray(ribbon.geo3),
    geo4: ribbonArray(ribbon.geo4),
    front: ribbonArray(ribbon.front),
    back: ribbonArray(ribbon.back),
    /**
     * The shimmer: a wave that runs along every ribbon without end, as bright
     * as the owner's activity (`reactions.impulse`): where it is, and how much.
     */
    shimmer: uniform(new Vector2(0, 0)),
    /** The pointer's wind puffs: x, y, vx, vy; and their ages. */
    puffs: Array.from({ length: PUFFS }, () => uniform(new Vector4())),
    puffAges: Array.from({ length: PUFFS }, () => uniform(99)),
    puffCount: uniform(0),
  };
}
export type SilkUniforms = ReturnType<typeof silkUniforms>;

/** What the graph may read about each ribbon as a constant: its layer never changes. */
export interface RibbonDepths {
  readonly depth: readonly number[];
  readonly sheer: readonly number[];
}

// ---------- thin-film iridescence (Belcour & Barla 2017, after the Khronos glTF reference) ----------
const FILM_IOR = 1.42;
const BASE_IOR = 1.56;
const f0Of = (n1: number, n2: number) => ((n1 - n2) / (n1 + n2)) ** 2;
const F0_FILM = f0Of(FILM_IOR, 1);
const F0_BASE = f0Of(BASE_IOR, FILM_IOR);
// The spectral sensitivity's Gaussians, folded with the phase's 2π·1e-9 and the XYZ normalisation.
const PHASE = 2 * PI * 1e-9;
const VAL = [5.4856e-13, 4.4201e-13, 5.2481e-13] as const;
const POS = [1.681e6, 1.7953e6, 2.2084e6] as const;
const VAR = [4.3278e9, 9.3046e9, 6.6121e9] as const;
const GAIN = VAL.map((v, c) => (v * Math.sqrt(2 * PI * (VAR[c] ?? 1))) / 1.0685e-7);
const FREQ = POS.map((p) => p * PHASE);
const SPREAD = VAR.map((v) => v * PHASE * PHASE);
const EXTRA = [
  (9.747e-14 * Math.sqrt(2 * PI * 4.5282e9)) / 1.0685e-7,
  2.2399e6 * PHASE,
  4.5282e9 * PHASE * PHASE,
] as const;

/** The film's response at optical path `opd` (nm) with phase shift `shift`, in linear Rec.709. */
function sensitivity(opd: F, shift: number): V3 {
  const o2 = opd.mul(opd);
  const at = (c: 0 | 1 | 2) =>
    cos(opd.mul(FREQ[c] ?? 0).add(shift))
      .mul(exp(o2.mul(-(SPREAD[c] ?? 0))))
      .mul(GAIN[c] ?? 0);
  const x = at(0).add(
    cos(opd.mul(EXTRA[1]).add(shift))
      .mul(exp(o2.mul(-EXTRA[2])))
      .mul(EXTRA[0]),
  );
  const y = at(1);
  const z = at(2);
  return vec3(
    x.mul(3.2404542).sub(y.mul(1.5371385)).sub(z.mul(0.4985314)),
    x.mul(-0.969266).add(y.mul(1.8760108)).add(z.mul(0.041556)),
    x.mul(0.0556434).sub(y.mul(0.2040259)).add(z.mul(1.0572252)),
  );
}

const iridescence = Fn(([cos1, d]: readonly [F, F]) => {
  const s2 = float(1)
    .sub(cos1.mul(cos1))
    .div(FILM_IOR * FILM_IOR);
  const cos2 = sqrt(max(float(1).sub(s2), 0));
  const R12 = float(F0_FILM).add(pow(float(1).sub(cos1), 5).mul(1 - F0_FILM));
  const T121 = float(1).sub(R12);
  const R23 = float(F0_BASE).add(pow(float(1).sub(cos2), 5).mul(1 - F0_BASE));
  const opd = d.mul(cos2).mul(2 * FILM_IOR);
  const R123 = clamp(R12.mul(R23), 1e-5, 0.9999);
  const r123 = sqrt(R123);
  const Rs = T121.mul(T121).mul(R23).div(float(1).sub(R123));
  // The film is denser than air and the base denser than the film: every bounce shifts by π.
  const C1 = Rs.sub(T121).mul(r123);
  const C2 = C1.mul(r123);
  const I = vec3(R12.add(Rs))
    .add(sensitivity(opd, PI).mul(C1.mul(2)))
    .add(sensitivity(opd.mul(2), 2 * PI).mul(C2.mul(2)));
  return max(I, vec3(0, 0, 0));
}).setLayout({
  name: "kbSilkIridescence",
  type: "vec3",
  inputs: [
    { name: "cos1", type: "float" },
    { name: "d", type: "float" },
  ],
});

/** A surface frame: the normal, the fibre's tangent, and across the fibre. */
interface Fibre {
  readonly n: V3;
  readonly T: V3;
  readonly B: V3;
}

/** Anisotropic GGX (Burley's form): a light becomes a band across the ribbon where it turns to face it. */
function aniso(H: V3, { n, T, B: across }: Fibre, at: F, ab: F): F {
  const x = dot(H, T).div(at);
  const y = dot(H, across).div(ab);
  const z = dot(H, n);
  const d = x.mul(x).add(y.mul(y)).add(z.mul(z));
  return float(1).div(at.mul(ab).mul(d).mul(d).mul(PI));
}

/** The ribbons' geometry over the uniforms: their shapes, edges and layers. */
function ribbonGeometry(u: SilkUniforms, wake: DataTexture) {
  const pulseAt = Fn(([x]: readonly [F]) => {
    // The nearest crest of a wave that repeats every 4.8 along x (the strip's span).
    const d = fract(x.sub(u.shimmer.x).div(4.8).add(0.5)).sub(0.5).mul(4.8);
    return exp(d.mul(d).mul(-5)).mul(u.shimmer.y);
  }).setLayout({ name: "kbSilkPulse", type: "float", inputs: [{ name: "x", type: "float" }] });

  /** Ribbon `i` at `x`: its centre, its across-vector w·(cos θ, sin θ), and its width. */
  const frameAt = Fn(([i, x]: readonly [I, F]) => {
    const g1 = u.geo1.element(i);
    const g2 = u.geo2.element(i);
    const tt = u.twist.mul(u.geo3.element(i).z);
    const wd = texture(wake, vec2(x.add(2.4).div(4.8), float(i).add(0.5).div(RIBBONS))).level(
      float(0),
    );
    const c = g1.x
      .add(u.geo4.element(i).x.mul(x))
      .add(g1.y.mul(sin(x.mul(g1.z).add(tt.mul(0.13)).add(g2.y))))
      .add(g1.w.mul(sin(x.mul(g2.x).sub(tt.mul(0.21)).add(g2.y.mul(2)))))
      .add(wd.x);
    const w = g2.z.mul(
      sin(x.mul(2.3).add(g2.y).add(tt.mul(0.1)))
        .mul(0.22)
        .add(0.78),
    );
    const th = x
      .mul(g2.w)
      .add(tt.mul(0.17))
      .add(g2.y.mul(1.3))
      .add(pulseAt(x).mul(2.4))
      .add(wd.x.mul(6))
      .add(wd.y.mul(2));
    return vec4(c, w.mul(cos(th)), w.mul(sin(th)), w);
  }).setLayout({
    name: "kbSilkFrame",
    type: "vec4",
    inputs: [
      { name: "i", type: "int" },
      { name: "x", type: "float" },
    ],
  });

  /** Each layer at its depth: BG drifts against the pointer, MG with it, FG fastest. */
  const layerQ = (q: V2, depth: F | number): V2 =>
    q
      .sub(vec2(0, u.lift))
      .mul(asFloat(depth).mul(0.12).add(1))
      .add(u.parallax.mul(asFloat(depth).mul(-0.075).add(0.035)));

  /** Whether `p` (in ribbon `i`'s layer) is within `margin` of its band. */
  const inBand = (i: I, p: V2, margin: F | number): B => {
    const g1 = u.geo1.element(i);
    return abs(p.y.sub(g1.x).sub(u.geo4.element(i).x.mul(p.x))).lessThan(
      g1.y.add(g1.w).add(u.geo2.element(i).z).add(margin),
    );
  };

  /** Ribbon `i`'s signed edge distance at `q` (shadows, occlusion), 1 well outside its band. */
  const edgeAt = Fn(([i, q]: readonly [I, V2]) => {
    const p = layerQ(q, u.geo3.element(i).x);
    const out = float(1).toVar();
    If(inBand(i, p, 0.08), () => {
      const F2 = frameAt(i, p.x);
      const wc = max(abs(F2.y), 1e-5);
      out.assign(abs(p.y.sub(F2.x).div(wc)).sub(1).mul(wc));
    });
    return out;
  }).setLayout({
    name: "kbSilkEdge",
    type: "float",
    inputs: [
      { name: "i", type: "int" },
      { name: "q", type: "vec2" },
    ],
  });

  return { pulseAt, frameAt, edgeAt, layerQ, inBand };
}
type Geometry = ReturnType<typeof ribbonGeometry>;

/** The lights every layer shares. */
function stageLights(u: SilkUniforms) {
  const dark = u.dark;
  return {
    keyDir: normalize(byPage3(vec3(-0.1, 0.75, 0.65), vec3(0.08, 0.72, 0.62), dark)),
    keyCol: byPage3(vec3(1.05, 1.02, 0.98), vec3(3.2, 2.37, 1.54), dark),
    backDir: normalize(vec3(0.1, 0.6, -0.8)),
    backCol: byPage3(vec3(0.6, 0.64, 0.7), vec3(0.84, 1.32, 2.4), dark),
    /** The strip light's band: it reaches the far layers first. */
    sweepBand: (q: V2, depth: F | number): F =>
      exp(
        q.x
          .add(q.y.mul(0.7))
          .sub(u.sweep.sub(asFloat(depth).mul(0.28)))
          .pow(2)
          .div(-0.05),
      ),
    sweepDir: normalize(vec2(u.sweep.mul(0.2).sub(0.25), 0.65)),
  };
}
type Lights = ReturnType<typeof stageLights>;

/** What a pixel of ribbon `i` is, as the layer function found it. */
interface Surface {
  readonly i: I;
  readonly q: V2;
  readonly x: F;
  readonly s: F;
  readonly fibre: Fibre;
  readonly base: V3;
  readonly detail: F;
}

/** What reaches a ribbon's pixel: ambient (occ), the key (sh), the sweep (sw), and the haze it sinks in. */
interface Reach {
  readonly occ: F;
  readonly sh: F;
  readonly sw: F;
  readonly haze: V3;
}

/** Ribbon `i`'s silk at one pixel, lit. */
function shadeSilk(
  u: SilkUniforms,
  geo: Geometry,
  lights: Lights,
  surface: Surface,
  reach: Reach,
): V3 {
  const dark = u.dark;
  const { i, q, x, s, base, detail } = surface;
  const g3 = u.geo3.element(i);
  const depth = g3.x;
  const sheer = g3.y;
  const coc = g3.w;
  const { n: n0, T, B: across } = surface.fibre;
  // The woven warp: threads along the ribbon bend the normal across.
  const n = normalize(n0.add(across.mul(sin(s.mul(14 * 2 * PI)).mul(detail.mul(0.16))))).toVar();
  const fibre = { n, T, B: across };
  const blur = clamp(coc.div(8), 0, 1);
  const at = mix(0.075, 0.3, blur);
  const ab = mix(0.45, 0.8, blur);
  // Thin film: one spectral evaluation a pixel, at the view angle; the thickness flows with the cloth.
  const film = fbm4(vec2(x.mul(0.7).sub(u.time.mul(0.035)), s.mul(0.45).add(float(i).mul(3.1))))
    .mul(420)
    .add(480)
    .add(geo.pulseAt(x).mul(380));
  const nv = max(n.z, 0.02);
  const irid0 = iridescence(nv, film);
  const irid = mix(
    vec3(1, 1, 1),
    irid0.div(dot(irid0, vec3(1 / 3, 1 / 3, 1 / 3)).add(1e-4)),
    byPage(0.72, 0.62, dark),
  );
  const swept = lights
    .sweepBand(q, depth)
    .mul(float(1).sub(u.calm.mul(0.8)))
    .mul(reach.sw);
  const sources: readonly (readonly [V3, V3])[] = [
    [
      lights.keyDir,
      lights.keyCol.mul(mix(float(1), spotPool(q).mul(0.75).add(0.25), dark)).mul(reach.sh),
    ],
    [lights.backDir, lights.backCol],
    [
      normalize(vec3(u.sweep.mul(0.2).sub(0.25), 0.65, 0.7)),
      vec3(1, 0.95, 0.9)
        .mul(byPage(1, 2.2, dark))
        .mul(swept),
    ],
  ];
  let lit: V3 = vec3(0, 0, 0);
  for (const [L, C] of sources) {
    const ndl = dot(n, L);
    const H = normalize(L.add(vec3(0, 0, 1)));
    const vis = smoothstep(-0.1, 0.3, ndl);
    const d1 = min(aniso(H, fibre, at, ab), 60);
    const d2 = min(aniso(H, fibre, at.mul(3), ab.mul(1.3)), 12);
    const spec = irid
      .mul(d1.mul(0.07))
      .add(sqrt(base).mul(d2.mul(0.035)))
      .mul(vis);
    const diff = base.mul(max(ndl.mul(0.6).add(0.4), 0)).mul(byPage(0.5, 0.32, dark));
    const trans = pow(base, vec3(1.25, 1.25, 1.25)).mul(sheer.mul(max(ndl.negate(), 0)).mul(1.8));
    lit = lit.add(
      C.mul(
        diff
          .mul(float(1).sub(sheer.mul(0.45)))
          .add(spec)
          .add(trans),
      ),
    );
  }
  const col = lit
    .add(base.mul(byPage3(vec3(0.2, 0.22, 0.26), vec3(0.05, 0.015, 0.035), dark)).mul(reach.occ))
    .add(
      base
        .mul(pow(float(1).sub(nv), 3))
        .mul(byPage3(vec3(0.4, 0.4, 0.4), vec3(0.35, 0.2, 0.4), dark))
        .mul(reach.occ),
    )
    .mul(mix(float(1), reach.occ, 0.8));
  // BG sinks into the cosmic haze; the FG sits outside the key.
  const dp = max(depth, 0);
  return mix(col, reach.haze, dp.mul(0.5))
    .mul(float(1).sub(dp.mul(byPage(0.1, 0.35, dark))))
    .mul(select(depth.lessThan(-0.5), mix(float(1), float(0.65), dark), float(1)));
}

/** Ribbon `i` over `under`: hit, shaded, and laid on with its coverage. */
function layerFunction(u: SilkUniforms, geo: Geometry, lights: Lights) {
  return Fn(([i, q, under, occ, sh, sw, haze, pix]: readonly [I, V2, V3, F, F, F, V3, F]) => {
    const g3 = u.geo3.element(i);
    const coc = g3.w;
    const p = geo.layerQ(q, g3.x).toVar();
    const out = under.toVar();
    If(geo.inBand(i, p, coc.mul(2 / REFERENCE_HEIGHT).add(0.07)), () => {
      const e = 0.012; // about one wake texel: smooth normals through it
      const F1 = geo.frameAt(i, p.x).toVar();
      const F2 = geo.frameAt(i, p.x.add(e)).toVar();
      const dc = F2.x.sub(F1.x).div(e).toVar();
      const wc = select(abs(F1.y).lessThan(1e-5), float(1e-5), F1.y).toVar();
      const s0 = p.y.sub(F1.x).div(wc).toVar();
      const slope = sqrt(dc.mul(dc).add(1)).toVar();
      const edge = abs(s0).sub(1).mul(abs(wc)).div(slope);
      const k = max(coc.add(1).div(REFERENCE_HEIGHT), pix.mul(1.2));
      const c0 = clamp(float(0.5).sub(edge.div(k.mul(1.6))), 0, 1);
      const cov = c0
        .mul(c0)
        .mul(float(3).sub(c0.mul(2)))
        .toVar();
      If(cov.greaterThan(0), () => {
        const s = clamp(s0, -1, 1).toVar();
        const Tx = vec3(1, dc.add(s.mul(F2.y.sub(F1.y).div(e))), s.mul(F2.z.sub(F1.z).div(e)));
        const n0 = normalize(cross(Tx, vec3(0, F1.y, F1.z))).toVar();
        const facing = n0.z.greaterThanEqual(0);
        const n = select(facing, n0, n0.negate()).toVar();
        const T = normalize(Tx).toVar();
        // A thread's footprint, analytically: the warp fades as it nears a pixel, and when defocused.
        const footprint = slope.mul(pix).mul(14).div(abs(wc));
        const detail = float(1)
          .sub(smoothstep(0.15, 0.45, footprint))
          .mul(float(1).sub(smoothstep(0, 2, coc)));
        const col = shadeSilk(
          u,
          geo,
          lights,
          {
            i,
            q,
            x: p.x,
            s,
            fibre: { n, T, B: normalize(cross(n, T)) },
            base: select(facing, u.front.element(i).xyz, u.back.element(i).xyz),
            detail,
          },
          { occ, sh, sw, haze },
        );
        out.assign(mix(under, col, cov.mul(float(1).sub(g3.y.mul(0.55)))));
      });
    });
    return out;
  }).setLayout({
    name: "kbSilkLayer",
    type: "vec3",
    inputs: [
      { name: "i", type: "int" },
      { name: "q", type: "vec2" },
      { name: "under", type: "vec3" },
      { name: "occ", type: "float" },
      { name: "sh", type: "float" },
      { name: "sw", type: "float" },
      { name: "haze", type: "vec3" },
      { name: "pix", type: "float" },
    ],
  });
}

/** The hero's coloured shadows and caustics on the backdrop, and the sweep cut by every ribbon. */
function onTheBackdrop(
  u: SilkUniforms,
  scene: SceneParts,
  q: V2,
  density: F,
): { tint: V3; light: V3 } {
  const { geo, lights, depths } = scene;
  const dark = u.dark;
  const tint = vec3(1, 1, 1).toVar();
  const caustic = float(0).toVar();
  for (const i of HERO) {
    const depth = depths.depth[i] ?? 0;
    const sheer = depths.sheer[i] ?? 0;
    const gap = byPage(0.14, 0.09, dark).mul(1.2 - depth * 0.6);
    const qs = q.add(lights.keyDir.xy.mul(gap)).toVar();
    const pen = gap.mul(0.25).add(0.012);
    const sc = float(1)
      .sub(smoothstep(pen.negate(), pen, geo.edgeAt(int(i), qs)))
      .toVar();
    const through = mix(vec3(0.18, 0.18, 0.18), sqrt(u.front.element(int(i)).xyz), sheer * 0.8);
    tint.mulAssign(mix(vec3(1, 1, 1), through, sc.mul(byPage(0.42, 0.55, dark))));
    // A sheer ribbon turning edge-on squeezes its light into a bright line.
    const F2 = geo.frameAt(int(i), geo.layerQ(qs, depth).x);
    caustic.addAssign(
      sc.mul(sheer).mul(
        clamp(
          float(0.022)
            .div(max(abs(F2.y), 0.004))
            .sub(0.35),
          0,
          2.5,
        ),
      ),
    );
  }
  const spotL = mix(float(1), spotPool(q), dark);
  const sweep = lights.sweepBand(q, 1.3).mul(float(1).sub(u.calm)).toVar();
  If(sweep.greaterThan(0.01), () => {
    for (let i = 0; i < RIBBONS; i++) {
      const depth = depths.depth[i] ?? 0;
      const sg = (1.15 - depth) * 0.07;
      const pen = u.geo3
        .element(int(i))
        .w.mul(0.002)
        .add(0.01 + sg * 0.4);
      const cut = float(1).sub(
        smoothstep(pen.negate(), pen, geo.edgeAt(int(i), q.add(lights.sweepDir.mul(sg)))),
      );
      sweep.mulAssign(float(1).sub(cut.mul(0.8 * (1 - (depths.sheer[i] ?? 0) * 0.5))));
    }
  });
  return {
    tint: mix(vec3(1, 1, 1), tint, mix(float(1), spotL.mul(0.9).add(0.1), dark)),
    light: byPage3(vec3(0.05, 0.048, 0.045), vec3(0.12, 0.096, 0.066).mul(spotL), dark)
      .mul(caustic)
      .add(
        byPage3(
          vec3(0.02, 0.0194, 0.0184),
          vec3(1, 0.85, 0.7).mul(density.mul(0.12).add(0.022)),
          dark,
        ).mul(sweep),
      ),
  };
}

/** What a ribbon `i` receives from the ones nearer the lens: ambient, the key, the sweep. */
function reachOf(u: SilkUniforms, scene: SceneParts, i: number, q: V2) {
  const { geo, lights, depths } = scene;
  const di = depths.depth[i] ?? 0;
  const occ = float(1).toVar();
  const sh = float(1).toVar();
  const sw = float(1).toVar();
  const swept = lights.sweepBand(q, di).greaterThan(0.01);
  for (let k = i + 1; k < RIBBONS; k++) {
    const dz = Math.abs((depths.depth[k] ?? 0) - di) + 0.08;
    if (dz < 0.18) continue; // the same layer: no gap for light to fall through
    const sheer = depths.sheer[k] ?? 0;
    if ((HERO as readonly number[]).includes(k)) {
      const ek = geo.edgeAt(int(k), q);
      const near = exp(
        max(ek, 0)
          .negate()
          .div(0.02 + dz * 0.05),
      ).mul(one(ek.greaterThan(0)));
      occ.mulAssign(float(1).sub(near.mul(0.55 * (1 - sheer * 0.4))));
      const es = geo.edgeAt(int(k), q.add(lights.keyDir.xy.mul(dz * 0.12)));
      sh.mulAssign(
        float(1).sub(
          float(1)
            .sub(smoothstep(-0.015, 0.015 + dz * 0.03, es))
            .mul(0.6 * (1 - sheer * 0.5)),
        ),
      );
    }
    If(swept, () => {
      const pen = u.geo3
        .element(int(k))
        .w.mul(0.0025)
        .add(0.012 + dz * 0.03);
      const ew = geo.edgeAt(int(k), q.add(lights.sweepDir.mul(dz * 0.07)));
      sw.mulAssign(
        float(1).sub(
          float(1)
            .sub(smoothstep(pen.negate(), pen, ew))
            .mul(0.85 * (1 - sheer * 0.45)),
        ),
      );
    });
  }
  return { occ, sh, sw };
}

/** The graph's shared parts. */
interface SceneParts {
  readonly geo: Geometry;
  readonly lights: Lights;
  readonly depths: RibbonDepths;
}

/**
 * The offscreen picture: the whole scene in linear light, over the page's
 * ground (`ground` on a dark page, `page` on a light one, from `Grounds`).
 */
export function silkFragment(
  u: SilkUniforms,
  { wake, cosmos: cosmosPicture }: { readonly wake: DataTexture; readonly cosmos: PictureSampler },
  depths: RibbonDepths,
  { ground, page }: Grounds,
  { size }: OffscreenInputs,
): V4 {
  const scene: SceneParts = { geo: ribbonGeometry(u, wake), lights: stageLights(u), depths };
  const layer = layerFunction(u, scene.geo, scene.lights);
  const dark = u.dark;
  return Fn(() => {
    const at = uv();
    const q = vec2(at.x.sub(0.5).mul(u.aspect), at.y.sub(0.5)).toVar();
    const pix = float(1).div(size.y);
    // The cosmos and the near dust keep clear of the head's text.
    const away = float(1).sub(u.scrim.under(at).mul(0.85)).toVar();
    const cosmos = cosmosAt(u, q, away, cosmosPicture);
    const col = vec3(0, 0, 0).toVar();
    const haze = vec3(0, 0, 0).toVar();
    If(dark.greaterThan(0.5), () => {
      col.assign(velvetAt(u, q, ground, cosmos, away));
      haze.assign(
        ground
          .mul(0.9)
          .add(cosmos.hue.mul(cosmos.density.mul(0.06)))
          .add(vec3(0.02, 0.006, 0.02)),
      );
    }).Else(() => {
      col.assign(paperAt(q, page, cosmos));
      haze.assign(mix(page.mul(0.95), page.mul(cosmos.hue).mul(1.05), cosmos.density.mul(0.3)));
    });
    const backdrop = onTheBackdrop(u, scene, q, cosmos.density);
    col.assign(col.mul(backdrop.tint).add(backdrop.light));
    // The ribbons, far to near.
    for (let i = 0; i < RIBBONS; i++) {
      const { occ, sh, sw } = reachOf(u, scene, i, q);
      col.assign(layer(int(i), q, col, occ, sh, sw, haze, pix));
    }
    col.addAssign(dustAt(u, scene.lights.sweepBand, q, { haze, density: cosmos.density, away }));
    // Grade: plum in the shadows, warm highlights on the dark page.
    const lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
    const graded = mix(
      col.mul(vec3(1.06, 0.9, 1.12)),
      col.mul(vec3(1.04, 1, 0.94)),
      smoothstep(0.02, 0.6, lum),
    );
    return vec4(max(mix(col, graded, dark), vec3(0, 0, 0)), 1);
  })();
}

/** The cosmos's offscreen pass: its slow fields over `cosmosWindow` (`cosmosFields`). */
export function cosmosFragment(u: SilkUniforms): V4 {
  return Fn(() => {
    const at = uv();
    const w = u.cosmosWindow;
    return cosmosFields(u, vec2(mix(w.x, w.z, at.x), mix(w.y, w.w, at.y)));
  })();
}

/**
 * The frame, for `scene.backgroundNode`: the offscreen picture, a scrim
 * under the head's text, graded on a dark page as its look was drawn
 * (`darkGrade`, its highlights rolled off by the shoulder); on a light one
 * in the page's own terms (`paint`), its glints kept above white for the
 * bloom.
 */
export function silkFrame(
  u: SilkUniforms,
  picture: PictureSampler,
  { ground, page, paint }: Grounds,
): V3 {
  return Fn(() => {
    const at = vec2(screenUV.x, float(1).sub(screenUV.y));
    const shown = picture(at).rgb.toVar();
    // Under the head's text: darker under light text, paler under dark text.
    const scrim = u.scrim.under(at);
    shown.assign(
      mix(mix(shown, page, scrim.mul(0.26)), shown.mul(float(1).sub(scrim.mul(0.3))), u.dark),
    );
    const day = paint(min(shown, vec3(1, 1, 1))).add(max(shown.sub(1), vec3(0, 0, 0)));
    return mix(day, darkGrade(shown, ground), u.dark);
  })();
}
