/**
 * The Warp look's shader: a black hole as a graphic lens, seen almost edge
 * on through a thin, razor-bright disk. The look is inspired by the black
 * hole of Bruno Simon's Awwwards 2022 workshop; the technique and the code
 * are kb's own.
 *
 * - **A two-segment thin lens, no march.** A ray runs straight to the plane
 *   through the hole square to the view; there it is turned toward the hole
 *   by an angle that falls as one over how near it passed (`BEND`), and runs
 *   straight on. What the first segment meets is in front of the hole: the
 *   near side of the disk, crossing the shadow. What the second meets is
 *   behind it, seen bent: the far side of the disk lifted over the shadow as
 *   an arch and echoed under it, and the stars, crowded into a ring. A ray
 *   that passes inside the shadow's radius never leaves.
 * - **The disk is a sheet of streaming light.** A flat ring coloured by a
 *   ramp, white-hot at its inner lip through amber and rose to a violet
 *   tail; its streaks are periodic noise stretched round it, sheared by
 *   orbital speed (inner gas laps outer) and drifting slowly inward (infall,
 *   in log radius), two copies crossfading so the shear never winds them
 *   tight. The streaks warp the ramp, and the ramp sets the opacity: hot
 *   streaks are solid, faint gas is clear.
 * - **Doppler.** The side coming toward the camera is beamed: brighter and
 *   whiter; the receding side is dimmer and redder.
 * - **The photon ring:** a hairline at the shadow's rim, beamed like the
 *   disk, a texel wide at any size.
 * - **Dark** pages see light over the stage's ground; **light** pages an
 *   engraving: the disk as warm ink on the paper, its hot lip gilt, the
 *   shadow charcoal, the stars dust (`Grounds`).
 */
import {
  Fn,
  If,
  atan,
  clamp,
  cos,
  cross,
  dot,
  exp,
  float,
  fract,
  length,
  log,
  max,
  min,
  mix,
  normalize,
  pow,
  sin,
  smoothstep,
  sqrt,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import { Color, Vector2 } from "three/webgpu";
import type { OffscreenInputs, TslNode } from "@kb/scene-gpu";
import type { Grounds } from "../gpu/gpu-scene";
import { blackbody, fbm4, gnoise, pnoise } from "../gpu/noise";
import { starsOf } from "./stars";

type F = TslNode<"float">;
type V3 = TslNode<"vec3">;
type V4 = TslNode<"vec4">;

/** The shadow's radius, the unit everything else is measured in. */
const SHADOW = 1;
/** The disk's inner lip and outer reach. */
const INNER = 1.55;
const OUTER = 6.8;
/** The camera's distance from the hole. */
const DISTANCE = 10;
/** The bend: a ray passing at distance b is turned by BEND / b (radians), at most `MAX_BEND`. */
const BEND = 0.48;
const MAX_BEND = 1.35;
/** An authored roll: the disk's line leans a little. */
const ROLL = 0.19;
/**
 * Seconds a copy of the streaks is carried before it fades out: two copies,
 * half a period apart, crossfade, so the shear never winds them into rings.
 */
const FLOW = 13;
/** Orbital angular speed at radius 1 (rad/s), falling as r^-1.5. */
const SPIN = 0.62;
/** Log radius the streaks fall inward per second. */
const INFALL = 0.028;
/** The flare's orbit radius. */
const FLARE_RADIUS = 3;

export function warpUniforms() {
  return {
    time: uniform(0),
    dark: uniform(1),
    /** Where the hole sits, as shares of the frame (x from the left, y from the bottom). */
    center: uniform(new Vector2(0.63, 0.6)),
    /** The lens's focal length in frame heights: the hole's size in the frame. */
    focal: uniform(1.6),
    inclination: uniform(0.09),
    azimuth: uniform(0),
    /** The ramp's violet tail, turned a little each load. */
    tail: uniform(new Color(0.42, 0.13, 0.72)),
    /** Where this load's streaks start, in the noise. */
    offset: uniform(new Vector2(0, 0)),
    /** How bright the flare is (`reactions.stir`), the writes as a whole (`impulse`), typing (`calm`). */
    flare: uniform(0),
    flarePhase: uniform(0),
    pulse: uniform(0),
    calm: uniform(0),
  };
}
export type WarpUniforms = ReturnType<typeof warpUniforms>;

/** Angular speed of the gas at radius `r`. */
const spin = (r: F): F => pow(r, -1.5).mul(SPIN);

/**
 * The ramp: white-hot at 1, through amber, orange and rose, to the violet
 * tail at 0; above 1 (the Doppler-beamed side), hotter still. Its hot half
 * is a blackbody's, so it is kb's light, not a picked gradient.
 */
function ramp(u: WarpUniforms, heat: F): V3 {
  const hot = blackbody(mix(1.35, 9.5, pow(clamp(heat, 0, 1.4), 2.4)));
  const rose = vec3(1, 0.2, 0.42);
  const cool = mix(u.tail, rose, smoothstep(0.12, 0.42, heat));
  return mix(cool, hot, smoothstep(0.22, 0.52, heat)).mul(pow(heat, 1.35).mul(2.6));
}

/**
 * The disk at `hit` (on its plane), seen along `ray`: its light and opacity
 * (vec4: premultiplied rgb, alpha) and, in `w`, how hot it reads (the light
 * page inks by it). Zero off the ring.
 */
function discFn(u: WarpUniforms) {
  const fn = Fn(([hit, ray]: readonly [V3, V3]) => {
    const r = length(vec2(hit.x, hit.z));
    const angle = atan(hit.z, hit.x);
    // 1 at the inner lip, 0 at the outer reach, in log radius: the hot part gets the room.
    const lr = log(r);
    const span = float(1)
      .sub(lr.sub(Math.log(INNER)).div(Math.log(OUTER / INNER)))
      .toVar();
    const streaks = (carried: F, salt: number) => {
      const turns = angle.sub(spin(r).mul(carried)).div(6.2832);
      const infall = lr.add(carried.mul(INFALL)).add(u.offset.y);
      // The streaks' own coordinates warped by a slow field, so their edges are organic.
      const warp = gnoise(vec2(turns.mul(5).add(salt), infall.mul(4))).sub(0.5);
      const radial = infall.add(warp.mul(0.06));
      const along = turns.add(u.offset.x);
      return pnoise(vec2(along.mul(7), radial.mul(11).add(salt)), 7)
        .mul(0.5)
        .add(pnoise(vec2(along.mul(17), radial.mul(27).add(salt + 9)), 17).mul(0.32))
        .add(pnoise(vec2(along.mul(41), radial.mul(66).add(salt + 21)), 41).mul(0.18));
    };
    const a = fract(u.time.div(FLOW));
    const b = fract(u.time.div(FLOW).add(0.5));
    const weight = float(1).sub(a.mul(2).sub(1).abs());
    const turbulence = streaks(a.mul(FLOW), 0)
      .mul(weight)
      .add(streaks(b.mul(FLOW), 57).mul(float(1).sub(weight)));
    // A crisp inner lip (a texel or two of feather), a long ragged fade outward.
    const lip = smoothstep(1.0, 0.985, span);
    const reach = smoothstep(0, 0.55, span.add(turbulence.sub(0.5).mul(0.25)));
    const contrast = float(0.95).add(u.pulse.mul(0.2));
    const heat = clamp(pow(span, 1.3).mul(0.84).add(turbulence.sub(0.48).mul(contrast)), 0, 1)
      .mul(lip)
      .mul(reach)
      .toVar();
    // Doppler: the gas orbits; where it comes toward the camera it is beamed.
    const speed = clamp(sqrt(float(0.3).div(r)), 0, 0.55);
    const velocity = normalize(vec3(hit.z.negate(), 0, hit.x)).mul(speed);
    const toward = dot(velocity, ray.negate());
    const g = sqrt(float(1).sub(speed.mul(speed))).div(float(1).sub(toward));
    const beamed = heat.mul(mix(1, g, 0.4));
    // A write sets a hot knot orbiting in the gas.
    const at = u.flarePhase.add(spin(float(FLARE_RADIUS)).mul(u.time));
    const toFlare = vec2(hit.x, hit.z).sub(vec2(cos(at), sin(at)).mul(FLARE_RADIUS));
    const knot = exp(dot(toFlare, toFlare).mul(-2.2)).mul(u.flare).mul(heat.add(0.2));
    const fade = float(1).sub(u.calm.mul(0.3)).add(u.pulse.mul(0.3));
    const light = ramp(u, beamed.add(knot.mul(0.6)))
      .mul(pow(g, 1.4))
      .mul(fade);
    const alpha = clamp(pow(heat, 0.9).mul(1.25), 0, 1);
    return vec4(light.mul(alpha), alpha);
  }).setLayout({
    name: "kbWarpDisc",
    type: "vec4",
    inputs: [
      { name: "hit", type: "vec3" },
      { name: "ray", type: "vec3" },
    ],
  });
  return (hit: V3, ray: V3): V4 => fn(hit, ray);
}

/** Pastel stars, a few with a long glow, and a faint field of finer ones. */
const stars = starsOf("kbWarpStars", [
  { cells: 34, sparse: 0.9, gain: 1.1, sharpness: 150, halo: 0.5, salt: 3 },
  { cells: 80, sparse: 0.84, gain: 0.35, sharpness: 80, salt: 17 },
]);

/** The deep field behind the stars: a faint violet-indigo haze, two scales of it. */
function haze(d: V3): F {
  const sp = vec2(atan(d.z, d.x), d.y);
  return fbm4(sp.mul(vec2(2.2, 5)).add(11))
    .mul(0.7)
    .add(gnoise(sp.mul(vec2(9, 16))).mul(0.3));
}

/**
 * The offscreen pass: the frame of the hole. Night is light over the stage's
 * ground; day is composed in the page's own terms and painted through the
 * curve (`Grounds`).
 */
export function warpFragment(
  u: WarpUniforms,
  { size }: OffscreenInputs,
  { ground, page, paint }: Grounds,
): V4 {
  const disc = discFn(u);
  return Fn(() => {
    const at = uv();
    const aspect = size.x.div(size.y);
    const flat = vec2(at.x.sub(u.center.x).mul(aspect), at.y.sub(u.center.y));
    const q = vec2(
      flat.x.mul(Math.cos(ROLL)).sub(flat.y.mul(Math.sin(ROLL))),
      flat.x.mul(Math.sin(ROLL)).add(flat.y.mul(Math.cos(ROLL))),
    );
    const eye = vec3(
      cos(u.inclination).mul(sin(u.azimuth)),
      sin(u.inclination),
      cos(u.inclination).mul(cos(u.azimuth)).negate(),
    ).mul(DISTANCE);
    const forward = normalize(eye.negate());
    const right = normalize(cross(vec3(0, 1, 0), forward));
    const up = cross(forward, right);
    const ray = normalize(forward.mul(u.focal).add(right.mul(q.x)).add(up.mul(q.y))).toVar();

    // Where the ray passes the hole, and how near.
    const across = dot(eye, ray).negate();
    const pass = eye.add(ray.mul(across)).toVar();
    const b = length(pass).toVar();
    // A texel, in the units of the hole's plane: the ring and the shadow's rim are this sharp.
    const texel = float(DISTANCE).div(u.focal.mul(size.y));
    const escaped = smoothstep(texel.mul(-0.7).add(SHADOW), texel.mul(0.7).add(SHADOW), b);

    // First segment: the near side of the disk, in front of the hole.
    const near = vec4(0, 0, 0, 0).toVar();
    const t1 = eye.y.negate().div(ray.y);
    If(t1.greaterThan(0).and(t1.lessThan(across)), () => {
      const hit = eye.add(ray.mul(t1));
      const r = length(vec2(hit.x, hit.z));
      If(r.greaterThan(INNER * 0.98).and(r.lessThan(OUTER)), () => {
        near.assign(disc(hit, ray));
      });
    });

    // Second segment: turned toward the hole, on to the far side of the disk and the sky.
    const turn = min(float(BEND).div(max(b, SHADOW)), MAX_BEND);
    const bent = normalize(ray.mul(cos(turn)).sub(pass.div(max(b, 1e-4)).mul(sin(turn)))).toVar();
    const far = vec4(0, 0, 0, 0).toVar();
    const t2 = pass.y.negate().div(bent.y);
    If(t2.greaterThan(0), () => {
      const hit = pass.add(bent.mul(t2));
      const r = length(vec2(hit.x, hit.z));
      If(r.greaterThan(INNER * 0.98).and(r.lessThan(OUTER)), () => {
        far.assign(disc(hit, bent));
      });
    });

    // The photon ring: a hairline at the shadow's rim, beamed on the side that comes toward us.
    const ringWidth = max(texel.mul(0.9), 0.006);
    const offRing = b.sub(SHADOW + 0.022).div(ringWidth);
    const side = dot(pass.div(max(b, 1e-4)), right);
    const ring = exp(offRing.mul(offRing).negate())
      .mul(mix(0.45, 1.25, smoothstep(0.8, -0.8, side)))
      .mul(float(1).add(u.pulse.mul(0.4)));
    // What lies behind the hole, bent: the deep field and the stars.
    const field = haze(bent);
    const starlight = stars(bent);
    const dim = float(1).sub(exp(max(b.sub(SHADOW), 0).mul(-1.3)).mul(0.55));

    // Night: light over the ground; the shadow a deep tint of it, never black.
    const deep = ground.add(u.tail.mul(field.mul(field).mul(0.05)));
    const sky = mix(ground.mul(0.45), deep.add(starlight).mul(dim), escaped);
    // The lensed image is gathered toward the rim: the arch over the shadow burns brighter than the disk.
    const gathered = exp(max(b.sub(SHADOW), 0).mul(-3))
      .mul(1.5)
      .add(1);
    const behind = sky.mul(float(1).sub(far.a)).add(far.rgb.mul(gathered).mul(escaped));
    const night = behind
      .mul(float(1).sub(near.a))
      .add(near.rgb)
      .add(vec3(1, 0.82, 0.6).mul(ring.mul(2.2)).mul(escaped).mul(float(1).sub(near.a)));

    // GAP [[01M69N1WB5WSN86NWTBH0JEA93]] inks deeper than drawn: the stage fades a light page in linear light
    // Day: an ink drawing on the page. The shadow an indigo wash, deepest at its
    // rim, drawn round with the photon ring as a fine line; the gas inked by how
    // solid it is: violet in the tail, rose in the body, gilt at the hot lip.
    const washed = smoothstep(texel.mul(-1.5).add(SHADOW), SHADOW, b);
    // Densest low in the disc, where the ink pooled, and thinning toward the rim the line draws.
    const pooled = smoothstep(-0.9, 0.6, dot(pass, up).negate()).mul(
      smoothstep(SHADOW, SHADOW * 0.55, b),
    );
    const wash = mix(vec3(0.17, 0.12, 0.34), vec3(0.03, 0.02, 0.1), pooled.mul(0.75).add(0.25));
    const paper = page
      .mul(float(1).sub(field.sub(0.45).mul(0.05)))
      .mul(float(1).sub(length(starlight).mul(0.18)))
      .mul(mix(vec3(1, 1, 1), vec3(0.8, 0.76, 0.9), dim.oneMinus().mul(0.6)));
    const dayBehind = mix(wash.mul(page), paper, washed);
    const gold = vec3(0.88, 0.52, 0.08);
    const inkOf = (solid: F) =>
      mix(
        mix(vec3(0.34, 0.16, 0.62), vec3(0.78, 0.2, 0.32), smoothstep(0.12, 0.45, solid)),
        gold,
        smoothstep(0.62, 0.95, solid),
      );
    const layer = (under: V3, d: V4) => mix(under, inkOf(d.a).mul(page), clamp(d.a.mul(1.6), 0, 1));
    const day = paint(
      mix(
        layer(layer(dayBehind, far.mul(washed)), near),
        vec3(0.06, 0.045, 0.09).mul(page),
        clamp(ring, 0, 1).mul(float(1).sub(near.a)),
      ),
    );
    return vec4(mix(day, night, u.dark), 1);
  })();
}
