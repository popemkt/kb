/**
 * Floating geometry's shaders (T1): low-poly glass shards with warm light
 * coming through them, on a dark field.
 *
 * - **The glass** is drawn offscreen (`glassFragment`) at about a texel a CSS
 *   pixel: it is soft, as if a little out of focus, and the far shards more
 *   so. Each face is solved per pixel from its three corners (projected on
 *   the CPU each frame, `shards.ts`): how far inside it the pixel is, and how
 *   far from each edge. A face is faintly cool where the light misses it;
 *   light comes through it brightest along its edges, a little refracted
 *   inward, and through its body as it turns to face the lamp. Its edges are
 *   fine lines that burn gold near the lamp and fade to steel away from it,
 *   with a thin halo; the shards' tips meet in knots, and the knots near the
 *   lamp flare (the frame's only HDR, so the bloom finds them).
 * - **Dark** pages show the light over a navy haze on the page's own ground.
 *   **Light** pages show the same glass as a print would: each face takes a
 *   little of the paper, the edges are bronze lines that turn gold toward
 *   the lamp, and the lamp warms the paper round it. It is composed in the
 *   page's own terms (`Grounds`).
 * - **The frame** reads the glass and keeps it quiet under the head's text
 *   (`textScrim`).
 */
import {
  Fn,
  abs,
  clamp,
  dot,
  exp,
  float,
  length,
  max,
  min,
  mix,
  screenSize,
  screenUV,
  sign,
  smoothstep,
  step,
  uniform,
  uniformArray,
  uv,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import { Vector2, Vector4 } from "three/webgpu";
import type { TslNode } from "@kb/scene-gpu";
import type { Grounds } from "../gpu/gpu-scene";
import { fbm4 } from "../gpu/noise";
import type { textScrim } from "../gpu/text-scrim";
import { FACES } from "./shards";

type F = TslNode<"float">;
type V2 = TslNode<"vec2">;
type V3 = TslNode<"vec3">;

/** The lamp's light, and the glass where the lamp misses it (linear). */
const AMBER = vec3(1.0, 0.56, 0.22);
const GOLD = vec3(1.0, 0.78, 0.48);
const STEEL = vec3(0.32, 0.4, 0.7);
/** A light page's ink: the edges' bronze, warming to gold at the lamp, and the glass's cool grey. */
const BRONZE = vec3(0.32, 0.2, 0.08);
const GILT = vec3(0.78, 0.5, 0.16);
const GLASS = vec3(0.62, 0.7, 0.82);
const SUNLIT = vec3(1.0, 0.9, 0.74);

const vectors = (n: number) => Array.from({ length: n }, () => new Vector4());

/** Everything the CPU sets. Per face: `corners[2i]` A.xy B.xy, `corners[2i+1]` C.xy depth lit; `edges[i]` AB BC CA. */
export function glassUniforms() {
  /** The per-face values the CPU writes; the arrays below read these very objects. */
  const face = { corners: vectors(FACES * 2), edges: vectors(FACES) };
  return {
    face,
    dark: uniform(1),
    time: uniform(0),
    /** The lamp behind the glass, frame units (height 1, origin at the centre, y up). */
    lamp: uniform(new Vector2()),
    /** A dimmer lamp behind another knot. */
    second: uniform(new Vector2()),
    /** How bright the lamp is: 1 at rest, swelling with the owner's writes. */
    heat: uniform(1),
    /** The main knot, frame units: the haze gathers round it. */
    hub: uniform(new Vector2()),
    /** How large the composition is: the lamp's reach scales with it. */
    scale: uniform(1),
    /** The frame the glass pass covers: x0, y0, x1, y1. */
    window: uniform(new Vector4(-1, -0.5, 1, 0.5)),
    corners: uniformArray<"vec4">(face.corners, "vec4"),
    edges: uniformArray<"vec4">(face.edges, "vec4"),
  };
}
export type GlassUniforms = ReturnType<typeof glassUniforms>;

/** Distance from `p` (offset `pa` from the segment's start) to the segment along `e`. */
const segment = (pa: V2, e: V2): F =>
  length(pa.sub(e.mul(clamp(dot(pa, e).div(dot(e, e).add(1e-9)), 0, 1))));

/** How far `p` is inside the edge from a corner along `e` (negative outside), for a face of winding `s`. */
const inside = (pa: V2, e: V2, s: F): F =>
  e.x.mul(pa.y).sub(e.y.mul(pa.x)).mul(s).div(length(e).add(1e-9));

/** The glass pass: the light through the shards (dark), or what they leave of the paper (light). */
export function glassFragment(u: GlassUniforms): TslNode<"vec4"> {
  return Fn(() => {
    const at = uv();
    const p = vec2(mix(u.window.x, u.window.z, at.x), mix(u.window.y, u.window.w, at.y)).toVar();
    const toLamp = p.sub(u.lamp);
    const toSecond = p.sub(u.second);
    const reach = u.scale.mul(u.scale);
    const d2 = dot(toLamp, toLamp).div(reach);
    const s2 = dot(toSecond, toSecond).div(reach);
    // The lamps' field: a warmth, a tighter core where the light is hottest, and a faint glow
    // round them; the second lamp is a dimmer one behind another knot.
    const warmth = exp(d2.mul(-7))
      .add(exp(s2.mul(-12)).mul(0.55))
      .min(1)
      .toVar();
    const core = exp(d2.mul(-40))
      .add(exp(s2.mul(-60)).mul(0.5))
      .toVar();
    const glow = exp(d2.mul(-1.4)).toVar();
    const light = vec3(0, 0, 0).toVar();
    const paper = vec3(1, 1, 1).toVar();
    for (let i = 0; i < FACES; i++) {
      const ab = u.corners.element(i * 2);
      const cd = u.corners.element(i * 2 + 1);
      const edge = u.edges.element(i);
      const a = ab.xy;
      const b = ab.zw;
      const c = cd.xy;
      const depth = cd.z;
      const lit = cd.w;
      const e0 = b.sub(a);
      const e1 = c.sub(b);
      const e2 = a.sub(c);
      const area = e0.x.mul(c.y.sub(a.y)).sub(e0.y.mul(c.x.sub(a.x)));
      const shown = step(1e-5, abs(area));
      const s = sign(area);
      const pa = p.sub(a);
      const pb = p.sub(b);
      const pc = p.sub(c);
      const depthIn = min(min(inside(pa, e0, s), inside(pb, e1, s)), inside(pc, e2, s));
      // Far shards are out of focus: softer edges, wider halos, less light.
      const soft = depth.mul(0.014).add(0.0025);
      const fill = smoothstep(soft.negate(), soft, depthIn).mul(shown);
      const width = soft.mul(0.5).add(0.0008);
      const halo = depth.mul(0.025).add(0.014);
      const lineOf = (d: F, k: F) =>
        k.mul(exp(d.div(width).pow(2).negate()).add(exp(d.div(halo).negate()).mul(0.16)));
      const line = lineOf(segment(pa, e0), edge.x)
        .add(lineOf(segment(pb, e1), edge.y))
        .add(lineOf(segment(pc, e2), edge.z))
        .mul(shown);
      const near = float(1).sub(depth.mul(0.6));
      // Light refracted in from the edges, brightest just inside them.
      const rim = exp(max(depthIn, 0).div(depth.mul(0.06).add(0.05)).negate()).mul(fill);
      const facet = STEEL.mul(0.035)
        .add(AMBER.mul(warmth.mul(0.2).add(glow.mul(0.03)).mul(lit.mul(0.7).add(0.3))))
        .mul(fill)
        .add(mix(STEEL.mul(0.1), AMBER.mul(0.85), warmth).mul(rim.mul(lit.mul(0.6).add(0.4))));
      const edges = mix(STEEL.mul(0.22), GOLD.mul(1.35), warmth.add(glow.mul(0.15)).min(1)).mul(
        line.mul(lit.mul(0.4).add(0.6)),
      );
      // The tips meet in knots; a knot near the lamp flares.
      const toTip = p.sub(a);
      const knot = exp(dot(toTip, toTip).mul(-9000)).mul(core).mul(shown).mul(near).mul(2.5);
      light.addAssign(facet.add(edges).mul(near).add(GOLD.mul(knot)).mul(u.heat));
      // A light page: the glass takes a little of the paper, the edges are bronze turning gilt.
      const ink = mix(BRONZE, GILT, warmth);
      paper.mulAssign(mix(vec3(1, 1, 1), GLASS, fill.mul(near).mul(0.35)));
      paper.mulAssign(mix(vec3(1, 1, 1), ink, min(line.mul(near).mul(0.55), 0.85)));
    }
    // The field behind: a navy haze, and the lamp's warmth in the air.
    const haze = fbm4(p.mul(1.4).add(vec2(u.time.mul(0.006), u.time.mul(-0.004))));
    // The haze gathers round the glass and is gone before the frame's edge, so no rectangle shows.
    const fromHub = p.sub(u.hub);
    const gathered = exp(dot(fromHub, fromHub).div(reach).mul(-2.5));
    const air = vec3(0.008, 0.014, 0.032)
      .mul(haze.mul(0.9).add(0.35).mul(gathered))
      .add(AMBER.mul(warmth.mul(0.035).add(core.mul(0.03)).mul(u.heat)));
    const lit = light.add(air);
    const print = paper.mul(mix(vec3(1, 1, 1), SUNLIT, warmth.mul(0.55).mul(u.heat.min(1.6))));
    return vec4(mix(print, lit, u.dark), 1);
  })();
}

/**
 * The frame, for `scene.backgroundNode`: the glass (`glass`, the offscreen
 * picture) over the page's ground, quieter under the head's text.
 */
export function glassFrame(
  u: GlassUniforms,
  glass: (at: V2) => TslNode<"vec4">,
  scrim: ReturnType<typeof textScrim>,
  { ground, page, paint }: Grounds,
): V3 {
  return Fn(() => {
    const aspect = screenSize.x.div(screenSize.y);
    const q = vec2(screenUV.x.sub(0.5).mul(aspect), float(0.5).sub(screenUV.y));
    const span = vec2(u.window.z.sub(u.window.x), u.window.w.sub(u.window.y));
    const seen = glass(q.sub(vec2(u.window.x, u.window.y)).div(span)).rgb.toVar();
    const quiet = scrim.under(vec2(screenUV.x, float(1).sub(screenUV.y))).mul(0.7);
    const lit = ground.add(seen.mul(float(1).sub(quiet)));
    const print = paint(page.mul(mix(seen, vec3(1, 1, 1), quiet)));
    return mix(print, lit, u.dark);
  })();
}
