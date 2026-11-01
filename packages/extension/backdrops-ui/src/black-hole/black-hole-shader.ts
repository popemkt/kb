/**
 * The Black hole backdrop's shader (T1): Gargantua, after Interstellar.
 *
 * - **Light bends.** Each pixel traces a null geodesic of the Schwarzschild
 *   metric (rs = 1) in the effective-force form a = −3/2 · h² · r̂ / r⁴, with
 *   h = |r × v| conserved, and steps that shrink near the hole. So the far
 *   side of the disk shows over the shadow and under it, a photon ring hugs
 *   the shadow where rays wind round it, and the stars behind are lensed.
 * - **The disk is gas, not a ring.** A slab whose scale height grows outward,
 *   sampled through its thickness: its density streams round the hole
 *   (inner gas laps the outer, so filaments shear; two crossfading copies
 *   keep the shear from winding them into rings), long azimuthal filaments,
 *   wisps that billow above and below the midplane, a fuzzy top and bottom.
 *   Emission and absorption are composited front to back; the gas is hottest
 *   at its inner edge and in the midplane, redder outward and upward,
 *   Doppler-beamed (brighter where it comes toward us) and redshifted near
 *   the hole. A write sets a hot flare orbiting in it.
 * - **Cheap.** It is drawn offscreen (`offscreenPass`) at a resolution the
 *   scene lowers when frames run long; each frame jitters where along its
 *   steps it samples and blends into the frames before it (`history`), so
 *   one sample a step converges to a smooth disk.
 * - **Dark** pages see it as light on black; **light** pages as an eclipse
 *   by day: a high-key sky, a charcoal shadow, the disk as amber dust lit
 *   from the front, only its hot inner edge burning gold.
 */
import {
  Break,
  Fn,
  If,
  Loop,
  abs,
  asin,
  atan,
  clamp,
  cos,
  cross,
  dot,
  exp,
  float,
  fract,
  int,
  length,
  max,
  min,
  mix,
  normalize,
  pow,
  select,
  sin,
  smoothstep,
  sqrt,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import { Vector2 } from "three/webgpu";
import type { OffscreenInputs, TslNode } from "@kb/scene-gpu";
import type { Grounds } from "../gpu/gpu-scene";
import { blackbody, fbm4, pnoise } from "../gpu/noise";
import { starsOf } from "./stars";

type F = TslNode<"float">;
type V3 = TslNode<"vec3">;

const INNER = 2.6;
const OUTER = 13;
/** Within this radius a step through the slab takes at least `RING_SAMPLES` (see `throughSlab`). */
const RING_RADIUS = 4.5;
const RING_SAMPLES = 3;
/** The camera's distance from the hole, in Schwarzschild radii. */
const DISTANCE = 40;
/** A hair of roll: authored, not level. */
const ROLL = -0.06;

export function blackHoleUniforms() {
  return {
    time: uniform(0),
    dark: uniform(1),
    /** Where the hole sits, as shares of the frame (x from the left, y from the bottom). */
    center: uniform(new Vector2(0.63, 0.62)),
    /** The lens's focal length: the hole's size in the frame. */
    focal: uniform(2.3),
    inclination: uniform(0.105),
    azimuth: uniform(0),
    /** The most steps a ray takes, and samples per step through the slab. */
    steps: uniform(200, "int"),
    samples: uniform(2, "int"),
    /** A new jitter each frame, and how much of the new frame enters the history. */
    frame: uniform(0),
    blend: uniform(1),
    /** How bright the flare is, 0–1 (`reactions.stir`), and the owner's writes as a whole (`impulse`). */
    flare: uniform(0),
    pulse: uniform(0),
    flarePhase: uniform(0),
    calm: uniform(0),
  };
}
export type BlackHoleUniforms = ReturnType<typeof blackHoleUniforms>;

/** The gas's angular speed: the inner edge laps the outer, fast enough that the stream reads. */
const omega = (r: F): F => pow(r, -1.25).mul(2.6);
/**
 * Seconds a copy of the pattern is carried before it fades out: two copies,
 * half a period apart, crossfade, so the shear of differential rotation
 * never winds the gas into fine rings, however long the page is open.
 */
const FLOW = 14;
/** The slab's scale height, growing outward. */
const heightAt = (r: F): F => r.mul(0.022).add(0.05);

/** The gas at `c` (radius `r`): its density, and how near the midplane it is (1 at it). */
function densityFn(u: BlackHoleUniforms) {
  const fn = Fn(([c, r]: readonly [V3, F]) => {
    const angle = atan(c.z, c.x);
    const y = c.y.div(heightAt(r));
    const copy = (carried: F, seed: number) => {
      const turns = angle.sub(omega(r).mul(carried)).div(6.2832);
      const filaments = pnoise(vec2(turns.mul(14), r.mul(5).add(seed)), 14)
        .mul(0.55)
        .add(pnoise(vec2(turns.mul(40), r.mul(15).add(7 + seed)), 40).mul(0.45));
      const wisps = pnoise(
        vec2(
          turns.mul(9).add(y.mul(0.35)),
          r
            .mul(1.4)
            .add(y.mul(0.9))
            .add(20 + seed),
        ),
        9,
      );
      return filaments.mul(1.35).sub(0.32).add(wisps.sub(0.5).mul(0.6));
    };
    const a = fract(u.time.div(FLOW));
    const b = fract(u.time.div(FLOW).add(0.5));
    const weight = float(1).sub(a.mul(2).sub(1).abs());
    const gas = copy(a.mul(FLOW), 0)
      .mul(weight)
      .add(copy(b.mul(FLOW), 53).mul(float(1).sub(weight)))
      .clamp(0, 1.5);
    // The slab's top and bottom billow on a slow, rigid turn: no shear to wind them.
    const turns = angle.sub(u.time.mul(0.25)).div(6.2832);
    const billow = float(1).add(
      pnoise(vec2(turns.mul(7), r.mul(1.1).add(40)), 7)
        .sub(0.5)
        .mul(1.1),
    );
    const vertical = exp(y.mul(y).div(billow.mul(billow).mul(0.9)).negate());
    const radial = smoothstep(INNER * 0.9, INNER * 1.25, r).mul(smoothstep(OUTER, OUTER * 0.5, r));
    return vec2(radial.mul(vertical).mul(pow(gas, 3)).mul(1.8), vertical);
  }).setLayout({
    name: "kbDiskDensity",
    type: "vec2",
    inputs: [
      { name: "c", type: "vec3" },
      { name: "r", type: "float" },
    ],
  });
  return (c: V3, r: F) => fn(c, r);
}

/** The stars behind: two faint layers, fine and finer (`stars.ts`). */
const starsFn = starsOf("kbHoleStars", [
  { cells: 160, sparse: 0.975, gain: 0.7, sharpness: 60, salt: 0 },
  { cells: 380, sparse: 0.955, gain: 0.3, sharpness: 90, salt: 31 },
]);

/** The light page's sky, lensed like the stars: high-key haze with a little structure. */
function daySky(page: V3, d: V3): V3 {
  const sp = vec2(atan(d.z, d.x), asin(clamp(d.y, -1, 1)));
  const haze = fbm4(sp.mul(vec2(3, 6)).add(3));
  return page
    .mul(haze.sub(0.5).mul(0.06).add(1))
    .mul(mix(vec3(1, 1, 1), vec3(1.03, 0.99, 0.93), smoothstep(-0.3, 0.4, sp.y)));
}

/** What a ray's step through the slab reads and accumulates into. */
interface SlabStep {
  readonly u: BlackHoleUniforms;
  readonly density: (c: V3, r: F) => TslNode<"vec2">;
  readonly from: V3;
  readonly to: V3;
  readonly ray: V3;
  readonly jitter: F;
  readonly sigmaScale: F;
  readonly fade: F;
  readonly light: V3;
  readonly dust: V3;
  readonly through: F;
}

/** One step of a ray through the disk's slab: its samples' emission and dust, and what they absorb. */
function throughSlab({
  u,
  density,
  from: p,
  to: next,
  ray: v,
  jitter,
  sigmaScale,
  fade,
  light,
  dust,
  through,
}: SlabStep): void {
  // Near the inner edge, where the rays that wind round the hole cross the slab
  // and draw the photon ring, a step takes at least RING_SAMPLES samples: one
  // can miss so thin a crossing, and the ring breaks into dashes.
  const mid = p.add(next).mul(0.5);
  const each = float(u.samples);
  const samples = select(
    length(vec2(mid.x, mid.z)).lessThan(RING_RADIUS),
    max(each, RING_SAMPLES),
    each,
  ).toVar();
  const count = int(samples);
  const ds = length(next.sub(p)).div(samples);
  Loop({ start: 0, end: count, type: "int", condition: "<" }, ({ i }) => {
    const c = mix(p, next, float(i).add(jitter).div(samples)).toVar();
    const cr = length(vec2(c.x, c.z));
    const gas = density(c, cr).toVar();
    If(gas.x.greaterThan(0.002), () => {
      // The thin-disk profile, cooler (redder) away from the midplane.
      const x = float(INNER).div(cr);
      const heat = pow(x, 0.75)
        .mul(pow(max(float(1).sub(sqrt(x.mul(0.9))), 0), 0.25))
        .mul(2.1)
        .mul(mix(0.62, 1, gas.y));
      const speed = clamp(sqrt(float(0.5).div(cr.sub(1))), 0, 0.62);
      const velocity = normalize(vec3(c.z.negate(), 0, c.x)).mul(speed);
      const toward = normalize(v).negate();
      const g = sqrt(float(1).sub(dot(velocity, velocity)))
        .div(float(1).sub(dot(velocity, toward)))
        .mul(sqrt(float(1).sub(float(1).div(cr))));
      const beam = mix(1, g.mul(g).mul(g), 0.75);
      const angle = u.flarePhase.add(omega(float(5)).mul(u.time));
      const toFlare = vec2(c.x, c.z).sub(vec2(cos(angle), sin(angle)).mul(5));
      const flare = vec3(1, 0.85, 0.65)
        .mul(exp(dot(toFlare, toFlare).mul(-1.4)))
        .mul(u.flare)
        .mul(7);
      const emitted = blackbody(heat.mul(g).mul(2.7).add(1.5))
        .mul(pow(heat, 3.5).mul(2.1).add(0.05))
        .add(flare)
        .mul(beam)
        .mul(fade);
      const absorbed = float(1).sub(exp(gas.x.mul(sigmaScale).mul(ds).negate()));
      light.addAssign(emitted.mul(through.mul(absorbed)));
      dust.addAssign(
        mix(vec3(0.26, 0.14, 0.06), vec3(0.9, 0.58, 0.22), clamp(beam.mul(0.55), 0, 1))
          .mul(gas.y.mul(0.7).add(0.5))
          .mul(through.mul(absorbed)),
      );
      through.mulAssign(float(1).sub(absorbed));
    });
  });
}

/** The camera, on a sphere round the hole, and its ray through this frame's point in the texel at `at`. */
function cameraRay(u: BlackHoleUniforms, at: TslNode<"vec2">, size: TslNode<"vec2">) {
  const aspect = size.x.div(size.y);
  // Each frame's rays leave from a new point inside their texel (an R2 sequence),
  // so the history antialiases what is finer than a texel: the photon ring and the
  // filaments' edges, which a fixed grid draws as dashes and moiré.
  const subpixel = fract(u.frame.mul(vec2(0.7548777, 0.5698403)))
    .sub(0.5)
    .div(size);
  const ray = at.add(subpixel);
  const flat = vec2(ray.x.sub(u.center.x).mul(aspect), ray.y.sub(u.center.y));
  const q = vec2(
    flat.x.mul(Math.cos(ROLL)).sub(flat.y.mul(Math.sin(ROLL))),
    flat.x.mul(Math.sin(ROLL)).add(flat.y.mul(Math.cos(ROLL))),
  );
  // A camera on a sphere round the hole: the pointer tilts and swings it.
  const eye = vec3(
    cos(u.inclination).mul(sin(u.azimuth)),
    sin(u.inclination),
    cos(u.inclination).mul(cos(u.azimuth)).negate(),
  ).mul(DISTANCE);
  const forward = normalize(eye.negate());
  const right = normalize(cross(vec3(0, 1, 0), forward));
  const up = cross(forward, right);
  const v = normalize(forward.mul(u.focal).add(right.mul(q.x)).add(up.mul(q.y))).toVar();
  return { eye, v };
}

/**
 * The offscreen pass: one frame of the hole, blended into the history.
 * Night is light over the stage's ground; day is composed in the page's
 * own terms and painted through the curve (`Grounds`).
 */
export function blackHoleFragment(
  u: BlackHoleUniforms,
  { history, size }: OffscreenInputs,
  { ground, page, paint }: Grounds,
): TslNode<"vec4"> {
  const density = densityFn(u);
  return Fn(() => {
    const at = uv();
    const { eye, v } = cameraRay(u, at, size);
    // Interleaved gradient noise, moved each frame: where in each step this frame samples.
    const pixel = at.mul(size).floor();
    const jitter = fract(
      fract(dot(pixel, vec2(0.06711056, 0.00583715)))
        .mul(52.9829189)
        .add(u.frame.mul(0.618034)),
    );
    // The march starts a jittered part of a step along: the steps of a ray that winds
    // round the hole land somewhere new each frame, and the history draws the photon
    // ring whole instead of in dashes. Space is flat out here, so the ray is unbent.
    const p = vec3(eye)
      .add(v.mul(jitter.mul(1.2)))
      .toVar();
    const angular = cross(p, v);
    const h2 = dot(angular, angular);
    const light = vec3(0, 0, 0).toVar();
    const dust = vec3(0, 0, 0).toVar();
    const through = float(1).toVar();
    const swallowed = float(0).toVar();
    const nearest = float(99).toVar();
    const sigmaScale = mix(8, 3.2, u.dark);
    // Typing dims the disk a little and each keystroke breathes into it; a write flares.
    const fade = float(1).sub(u.calm.mul(0.35)).add(u.pulse.mul(0.4));

    Loop({ start: 0, end: u.steps, type: "int", condition: "<" }, () => {
      const r2 = dot(p, p);
      const r = sqrt(r2);
      nearest.assign(min(nearest, r));
      If(r.lessThan(1), () => {
        swallowed.assign(1);
        Break();
      });
      If(r.greaterThan(55).and(dot(p, v).greaterThan(0)), () => {
        Break();
      });
      const dt = clamp(r.mul(0.04).sub(0.02), 0.02, 1.2).toVar();
      If(
        abs(p.y)
          .lessThan(heightAt(r).mul(3.5))
          .and(r.lessThan(OUTER + 1)),
        () => {
          dt.assign(min(dt, r.mul(0.025).add(0.12)));
        },
      );
      v.addAssign(p.mul(h2.mul(-1.5).div(r2.mul(r2).mul(r))).mul(dt));
      const next = p.add(v.mul(dt)).toVar();
      const mid = p.add(next).mul(0.5);
      const rm = length(vec2(mid.x, mid.z));
      const inRing = rm.greaterThan(INNER * 0.85).and(rm.lessThan(OUTER));
      const nearSlab = min(abs(p.y), abs(next.y))
        .lessThan(heightAt(rm).mul(3.2))
        .or(p.y.mul(next.y).lessThan(0));
      If(inRing.and(nearSlab), () => {
        throughSlab({
          u,
          density,
          from: p,
          to: next,
          ray: v,
          jitter,
          sigmaScale,
          fade,
          light,
          dust,
          through,
        });
      });
      p.assign(next);
      If(through.lessThan(0.02), () => {
        Break();
      });
    });

    const away = normalize(v);
    // Dark: light on black, the stars lensed behind it.
    const night = mix(ground.add(starsFn(away)), vec3(0, 0, 0), swallowed)
      .mul(through)
      .add(light);
    // Light: an eclipse by day. The sky dims round the hole, as at totality.
    // The shadow's rim eased over the last rays that escape (closest to ~1.5, the
    // photon sphere), so the charcoal disc has an edge, not a staircase.
    const shade = max(swallowed, smoothstep(1.8, 1.5, nearest));
    const sky = mix(daySky(page, away), vec3(0.03, 0.026, 0.024), shade).mul(
      float(1).sub(exp(max(nearest.sub(1.5), 0).mul(-0.45)).mul(0.38)),
    );
    const day = paint(sky.mul(through).add(dust.mul(page).mul(1.25)).add(light.mul(0.05)));
    const frame = mix(day, night, u.dark);
    return vec4(mix(history(at).rgb, frame, u.blend), 1);
  })();
}
