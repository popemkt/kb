/**
 * The Warp look's shader: the lens-warp black hole after the demo in Bruno
 * Simon's Awwwards 2022 workshop; code written for kb. The technique is
 * re-created from a description of the picture, and the palette re-created
 * from samples of it; nothing of the demo's source is used.
 *
 * - **The hole is a pull, not a body.** Each pixel shows what lies nearer
 *   the hole than it does: its point in the frame is pulled toward the
 *   hole's by a strength (`pullOf`) that is 1 within the horizon's reach and
 *   0 beyond the lens's, measured where the pixel's ray meets the nearer of
 *   two surfaces through the hole, a sheet square to the view and the
 *   disk's own plane. Where the strength is 1 every pixel shows the hole's
 *   own point, which is empty: the shadow is a collapsed lookup with no
 *   edge of its own. Above the hole the pulled pixels find the disk's far
 *   side, bent over the shadow as an arch; under the near side, the sheet
 *   in the disk's plane folds a small whole image of the disk, the echo;
 *   round it, the stars are drawn out into thin arcs.
 * - **The disk is a flat ring of streaming light.** Four octaves of periodic
 *   noise, each drifting round and inward at its own speed (the inner gas
 *   laps the outer), give a turbulence that pushes a ramp coordinate up the
 *   ring's radius; the ramp sets colour and opacity alike, so hot streaks
 *   are solid and the faint outer gas is clear. Its stops are sampled from
 *   the reference: white-hot, cream, peach, orange, red, crimson, violet,
 *   plum, into a near-black purple sky.
 * - **Dark** pages see the picture as the display shows it, painted through
 *   the stage's curve (`Grounds.paint`); **light** pages an ink drawing on
 *   the paper: the shadow a soft indigo wash, the gas inked by how solid it
 *   is, the stars fine ink arcs.
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
  length,
  max,
  mix,
  normalize,
  select,
  sin,
  smoothstep,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import { Vector2 } from "three/webgpu";
import type { OffscreenInputs, TslNode } from "@kb/scene-gpu";
import type { Grounds } from "../gpu/gpu-scene";
import { pnoise } from "../gpu/noise";
import { starsOf } from "./stars";

type F = TslNode<"float">;
type V2 = TslNode<"vec2">;
type V3 = TslNode<"vec3">;
type V4 = TslNode<"vec4">;

/** The camera's distance from the hole: the unit everything else is measured in is a tenth of it. */
const DISTANCE = 10;
/** Within `HORIZON` of the hole the pull is whole; beyond `REACH` there is none. */
const HORIZON = 0.8;
const REACH = 2;
/** The disk's plane carries the pull out to `SHEET`, fading from `SHEET_FADE`. */
const SHEET = 6;
const SHEET_FADE = 4.8;
/** The disk's inner lip and outer reach. */
const INNER = 1.5;
const OUTER = 6;
/** An authored roll: the disk's line falls to the right. */
const ROLL = 0.2;
/** How far the turbulence pushes the ramp: the streaks' contrast. */
const STREAKS = 0.4;
/**
 * The turbulence's octaves: cells round the ring and across it, and how fast
 * each drifts (turns a second round it, ring-widths a second inward). The
 * finest drifts slowest, so the bands slide past one another.
 */
const OCTAVES: readonly {
  readonly cells: number;
  readonly round: number;
  readonly inward: number;
}[] = [
  { cells: 5, round: 0.09, inward: 0.09 },
  { cells: 10, round: 0.075, inward: 0.075 },
  { cells: 20, round: 0.06, inward: 0.06 },
  { cells: 40, round: 0.045, inward: 0.045 },
  { cells: 80, round: 0.035, inward: 0.035 },
];
/** The flare's orbit radius. */
const FLARE_RADIUS = 3;

/** The sky behind it all, in sRGB: a near-black purple, sampled from the reference; the ramp starts at it. */
const SKY: readonly [number, number, number] = [19, 14, 22];
/**
 * The ramp, as the display shows it over the sky, in sRGB: the colours
 * sampled from the reference along its disk from the outer fringe to the
 * white-hot lip, each at the ramp coordinate (`at`) where it covers as much
 * of the frame as it does in the reference (fitted by quantiles). Below the
 * first, it runs down to the sky at 0.
 */
const RAMP: readonly { readonly at: number; readonly srgb: readonly [number, number, number] }[] = [
  { at: 0.2, srgb: [59, 15, 67] },
  { at: 0.52, srgb: [97, 16, 80] },
  { at: 0.65, srgb: [144, 18, 73] },
  { at: 0.83, srgb: [185, 36, 50] },
  { at: 0.92, srgb: [209, 71, 40] },
  { at: 0.96, srgb: [222, 108, 50] },
  { at: 1.02, srgb: [232, 150, 82] },
  { at: 1.09, srgb: [245, 191, 134] },
  { at: 1.15, srgb: [255, 226, 190] },
  { at: 1.3, srgb: [255, 249, 238] },
];

const linear = (c: number) => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const shown = (c: readonly [number, number, number]) =>
  vec3(linear(c[0]), linear(c[1]), linear(c[2]));

export function warpUniforms() {
  return {
    time: uniform(0),
    dark: uniform(1),
    /** Where the hole sits, as shares of the frame (x from the left, y from the bottom). */
    center: uniform(new Vector2(0.63, 0.6)),
    /** The lens's focal length in frame heights: the hole's size in the frame. */
    focal: uniform(1.6),
    inclination: uniform(0.08),
    azimuth: uniform(0),
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

/** The ramp at `x` (0–1), as the display shows it: piecewise linear through `RAMP`. */
function ramp(x: F): V3 {
  let colour: V3 = shown(SKY);
  let from = 0;
  for (const stop of RAMP) {
    colour = mix(colour, shown(stop.srgb), clamp(x.sub(from).div(stop.at - from), 0, 1));
    from = stop.at;
  }
  return colour;
}

/** The camera on its sphere round the hole, and the ray through `q` (frame heights from the hole, rolled). */
function view(u: WarpUniforms) {
  const eye = vec3(
    cos(u.inclination).mul(sin(u.azimuth)),
    sin(u.inclination),
    cos(u.inclination).mul(cos(u.azimuth)).negate(),
  ).mul(DISTANCE);
  const forward = normalize(eye.negate());
  const right = normalize(cross(vec3(0, 1, 0), forward));
  const up = cross(forward, right);
  const ray = (q: V2): V3 => normalize(forward.mul(u.focal).add(right.mul(q.x)).add(up.mul(q.y)));
  return { eye, forward, ray };
}

/**
 * The pull at a ray: how near the hole it passes, as 1 inside `HORIZON`
 * falling to 0 at `REACH`. It is measured on the sheet square to the view
 * through the hole and, where the disk's plane lies in front of that sheet,
 * on the plane too, which covers the sheet's measure out to `SHEET` and fades
 * from `SHEET_FADE` to it, so the near side's measure gives way to the
 * sheet's past the disk and folds the echo there.
 */
function pullOf(eye: V3, forward: V3, ray: V3): F {
  const facing = forward.negate();
  const tSheet = dot(eye, facing).negate().div(dot(ray, facing));
  const across = smoothstep(REACH, HORIZON, length(eye.add(ray.mul(tSheet))));
  const tPlane = eye.y.negate().div(ray.y);
  const onPlane = length(eye.add(ray.mul(tPlane)));
  const inFront = tPlane.greaterThan(0).and(tPlane.lessThan(tSheet));
  const cover = select(inFront, smoothstep(SHEET, SHEET_FADE, onPlane), float(0));
  return mix(across, smoothstep(REACH, HORIZON, onPlane), cover);
}

/**
 * The disk where `ray` from `eye` meets its plane: its heat, the ramp
 * coordinate pushed up by the turbulence, which sets its colour and its
 * opacity alike. 0 off the ring.
 */
function discFn(u: WarpUniforms) {
  const fn = Fn(([eye, ray]: readonly [V3, V3]) => {
    const out = float(0).toVar();
    const t = eye.y.negate().div(ray.y);
    const hit = eye.add(ray.mul(t));
    const r = length(vec2(hit.x, hit.z));
    If(t.greaterThan(0).and(r.greaterThan(INNER)).and(r.lessThan(OUTER)), () => {
      // Round the ring, 0–1; across it, 1 at the inner lip and 0 at the outer reach.
      const round = atan(hit.z, hit.x).div(6.2832).add(0.5);
      const across = float(OUTER)
        .sub(r)
        .div(OUTER - INNER);
      let sum: F = float(0);
      for (const [k, octave] of OCTAVES.entries()) {
        const p = vec2(
          round.add(u.time.mul(octave.round)).add(u.offset.x.mul(k + 1)),
          across.sub(u.time.mul(octave.inward)).add(u.offset.y.mul(k + 1)),
        ).mul(octave.cells);
        // `pnoise` sits about 0.5 ± 0.35: centred and stretched past ±1, so the streaks outweigh the radius.
        const n = pnoise(p, octave.cells).sub(0.5).div(0.24);
        sum = sum.add(n.mul(n));
      }
      const turbulence = sum.sqrt();
      // Clear at both edges: the outer 40% fades out, the inner lip over its last 5%.
      const falloff = smoothstep(0, 0.4, across).mul(smoothstep(1, 0.95, across));
      // A write sets a hot knot orbiting in the gas.
      const at = u.flarePhase.add(u.time.mul(0.35));
      const toFlare = vec2(hit.x, hit.z).sub(vec2(cos(at), sin(at)).mul(FLARE_RADIUS));
      const knot = exp(dot(toFlare, toFlare).mul(-1.6)).mul(u.flare).mul(0.6);
      const contrast = float(STREAKS).add(u.pulse.mul(0.15));
      out.assign(across.add(turbulence.mul(contrast)).add(knot).mul(falloff));
    });
    return out;
  }).setLayout({
    name: "kbWarpDisc",
    type: "float",
    inputs: [
      { name: "eye", type: "vec3" },
      { name: "ray", type: "vec3" },
    ],
  });
  return (eye: V3, ray: V3): F => fn(eye, ray);
}

/** Pale stars of every hue, a few with a long glow, and a fainter field of finer ones. */
const stars = starsOf("kbWarpStars", [
  {
    cells: 50,
    sparse: 0.75,
    gain: 1.1,
    sharpness: 420,
    halo: 0.6,
    salt: 3,
    colour: { pastel: 0.8 },
  },
  { cells: 100, sparse: 0.94, gain: 0.5, sharpness: 300, salt: 17, colour: { pastel: 0.8 } },
]);

/**
 * The offscreen pass: the frame of the hole. Night is composed as the
 * display shows it and painted through the stage's curve; day is an ink
 * drawing in the page's own terms, painted the same way (`Grounds`).
 */
export function warpFragment(
  u: WarpUniforms,
  { size }: OffscreenInputs,
  { page, paint }: Grounds,
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
    const { eye, forward, ray } = view(u);
    // The pull: this pixel shows the point nearer the hole by its strength.
    const pull = pullOf(eye, forward, ray(q)).toVar();
    const pulled = ray(q.mul(float(1).sub(pull))).toVar();
    const heat = disc(eye, pulled).toVar();
    const opacity = clamp(heat, 0, 1);
    // The hole's own point is empty: no star may sit where the whole shadow looks.
    const empty = smoothstep(0.001, 0.005, length(q).mul(float(1).sub(pull)));
    const starlight = stars(pulled).mul(empty).toVar();
    // Typing dims the disk a little; a keystroke brightens it.
    const fade = float(1).sub(u.calm.mul(0.3)).add(u.pulse.mul(0.25));

    // Night: as the display shows it, the gas over the stars over the sky. The ramp is what
    // the display shows over the bare sky; the gas's own colour is what shows that at this
    // opacity, so the stars behind the faint gas still glow through it.
    const sky = shown(SKY).add(starlight);
    const gas = ramp(heat)
      .sub(shown(SKY).mul(float(1).sub(opacity)))
      .div(max(opacity, 0.001));
    const night = paint(mix(sky, gas.mul(fade), opacity));

    // GAP [[01M69N1WB5WSN86NWTBH0JEA93]] inks deeper than drawn: the stage fades a light page in linear light
    // Day: an ink drawing on the page. The shadow an indigo wash pooled where the
    // pull is whole and thinning over the lens's whole reach, so it has no edge;
    // the gas inked by its heat, so its streaks show: violet in its fringe, crimson
    // in its body, orange where it runs hot and amber in its hottest streaks; the
    // stars drawn out into fine ink arcs.
    const wash = pull.mul(pull);
    const paper = mix(page, vec3(0.05, 0.035, 0.14).mul(page), wash.mul(0.85));
    const starInk = clamp(length(starlight).mul(0.8), 0, 0.85).mul(float(1).sub(wash));
    const behind = mix(paper, vec3(0.2, 0.16, 0.3).mul(page), starInk);
    const ink = mix(
      mix(
        mix(vec3(0.36, 0.1, 0.5), vec3(0.72, 0.1, 0.3), smoothstep(0.2, 0.6, heat)),
        vec3(0.9, 0.42, 0.1),
        smoothstep(0.7, 0.95, heat),
      ),
      vec3(0.62, 0.26, 0.04),
      smoothstep(1, 1.25, heat),
    );
    const day = paint(mix(behind, ink.mul(page), clamp(heat.mul(1.3), 0, 1)));
    return vec4(mix(day, night, u.dark), 1);
  })();
}
