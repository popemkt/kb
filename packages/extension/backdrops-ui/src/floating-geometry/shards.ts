/**
 * Floating geometry's shards: a few great planes of glass hanging between
 * the piece and the far web, mid-scale, long and turned, crossing the head
 * as the reference's sweep of big shards does (`floating-geometry-shader.ts`
 * draws them in the field's pass).
 *
 * One to a cell across the frame, in heights, so a wider frame adds more of
 * the same, never larger ones. Each is a long triangle of clear glass: a
 * haze inside it, brighter toward the lamps, and its edges glowing where
 * the glass is thickest, warm near a lamp and cool far from one. It fades
 * whole by where its centre stands (`farField`), toward the frame's sides
 * and under the head's text, and rests high enough that its lowest corner
 * keeps clear of the frame's bottom, so no edge of the frame ever cuts one.
 */
import {
  abs,
  cos,
  dot,
  exp,
  float,
  floor,
  length,
  min,
  mix,
  normalize,
  sign,
  sin,
  smoothstep,
  vec2,
  vec3,
} from "three/tsl";
import type { TslNode } from "@kb/scene-gpu";
import { hash, hash2 } from "../gpu/noise";
import type { FarField } from "../gpu/dissolve";

type F = TslNode<"float">;
type V2 = TslNode<"vec2">;
type V3 = TslNode<"vec3">;

/**
 * The shards: one to a cell this wide (frame units); their half-lengths and
 * widths, how far they turn from level (radians), the heights their centres
 * rest between, and how far above the frame's bottom their lowest corner
 * keeps (all frame units).
 */
const SHARD = {
  cell: 1.15,
  half: [0.42, 0.62],
  wide: [0.16, 0.3],
  turn: 0.7,
  rest: [-0.08, 0.26],
  floor: -0.42,
} as const;

/** A shard's light where the cool glass is lit: a blue-violet, and the lamps' warm gold. */
const COOL = vec3(0.32, 0.42, 1.0);
const WARM = vec3(1.0, 0.56, 0.2);

/** What the shards leave at a pixel: their light (a dark page) and their ink (a light one, how much). */
export interface Shards {
  readonly light: V3;
  /** How much of the paper the shards' haze and edges tint, 0–1, and how warm that tint is. */
  readonly ink: F;
  readonly warm: F;
}

/** What a shard reads of the scene at a pixel. */
interface Around {
  /** The composition's scale, a texel of the pass (frame units) and the scene's clock. */
  readonly scale: F;
  readonly pixel: F;
  readonly time: F;
  /** How much of the far layer is left at the pixel itself (`farField`, read there). */
  readonly open: F;
}

/** How far `p` lies inside the edge from `a` to `b` of a triangle wound `wind` (±1); negative outside. */
const inside = (p: V2, a: V2, b: V2, wind: F): F => {
  const e = b.sub(a);
  const pa = p.sub(a);
  return e.x.mul(pa.y).sub(e.y.mul(pa.x)).mul(wind).div(length(e).add(1e-6));
};

/**
 * The shards at `p` (frame units): `lamp` is the main lamp.
 */
export function shardsAt(
  field: FarField,
  p: V2,
  lamp: V2,
  { scale, pixel, time, open }: Around,
): Shards {
  let light: V3 = vec3(0, 0, 0);
  let ink: F = float(0);
  let warmth: F = float(0);
  const home = floor(p.x.div(SHARD.cell));
  for (let k = -1; k <= 1; k++) {
    const cell = home.add(k);
    const h = hash2(vec2(cell, 23.9));
    const own = hash(vec2(cell, 8.3));
    const drift = sin(time.mul(0.02).add(own.mul(6.283))).mul(0.02);
    const half = mix(float(SHARD.half[0]), float(SHARD.half[1]), h.y);
    const wide = mix(float(SHARD.wide[0]), float(SHARD.wide[1]), own);
    const angle = h.x
      .sub(0.5)
      .mul(2 * SHARD.turn)
      .add(drift);
    const dir = vec2(cos(angle), sin(angle));
    const across = vec2(dir.y.negate(), dir.x);
    // Its corners about a centre, then lifted until the lowest keeps clear of the frame's bottom.
    const rest = vec2(
      cell.add(hash(vec2(cell, 3.7)).mul(0.6).add(0.2)).mul(SHARD.cell),
      mix(float(SHARD.rest[0]), float(SHARD.rest[1]), hash(vec2(cell, 17.1))),
    );
    const a0 = dir.mul(half);
    const b0 = dir.mul(half.negate()).add(across.mul(wide.mul(0.55)));
    const c0 = dir.mul(half.mul(-0.25)).sub(across.mul(wide));
    const lowest = min(min(a0.y, b0.y), c0.y);
    const centre = rest.add(vec2(0, rest.y.add(lowest).sub(SHARD.floor).negate().max(0)));
    const [a, b, c] = [centre.add(a0), centre.add(b0), centre.add(c0)];
    // Which way it is wound, so its edges' distances are positive inside.
    const ab = b.sub(a);
    const ac = c.sub(a);
    const wind = sign(ab.x.mul(ac.y).sub(ab.y.mul(ac.x)));
    const d = min(min(inside(p, a, b, wind), inside(p, b, c, wind)), inside(p, c, a, wind));
    // Whole by where it stands; and where it crosses the head's text or nears the frame's bottom,
    // that part of it thins too, so its lines never run through a title.
    const shown = field.standing(centre, own).mul(open);
    // Clear glass: a faint haze inside, brighter toward the lamp; its edges glow, a fine line in a
    // soft light that runs into the glass.
    const inGlass = smoothstep(pixel.negate(), pixel, d);
    const lit = exp(length(p.sub(lamp)).div(scale.mul(-0.9)));
    const toward = smoothstep(
      -1,
      1,
      dot(p.sub(centre), normalize(lamp.sub(centre).add(1e-5))).div(half),
    );
    const haze = inGlass.mul(toward.mul(0.7).add(0.3)).mul(0.055);
    const line = exp(abs(d).div(pixel.mul(1.3)).pow(2).negate());
    const glow = exp(abs(d).div(-0.018))
      .mul(0.25)
      .add(exp(d.max(0).div(-0.07)).mul(inGlass).mul(0.18));
    const edge = line.mul(0.55).add(glow).mul(lit.mul(1.6).add(0.4));
    const amount = haze.add(edge.mul(0.5)).mul(shown);
    light = light.add(mix(COOL.mul(0.35), WARM, lit.min(1)).mul(amount));
    ink = ink.add(haze.mul(2.2).add(line.mul(0.35)).add(glow.mul(0.6)).mul(shown));
    warmth = warmth.max(lit.mul(shown));
  }
  return { light, ink: ink.min(1), warm: warmth.min(1) };
}
