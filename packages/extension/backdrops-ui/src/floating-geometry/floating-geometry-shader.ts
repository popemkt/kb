/**
 * Floating geometry's shaders (T1): low-poly glass shards with warm light
 * coming through them, on a dark field.
 *
 * - **The glass** is drawn offscreen (`glassFragment`) at the device's own
 *   pixels, each edge antialiased over one of them (`pixel`): the near
 *   shards are crisp, and only the far ones a little out of focus. Each face
 *   is solved per pixel from its three corners (projected on the CPU each
 *   frame, `shards.ts`): how far inside it the pixel is, and how far from
 *   each edge. A face is faintly cool where the light misses it;
 *   light comes through it brightest along its edges, a little refracted
 *   inward, and through its body as it turns to face the lamp. Its edges are
 *   fine lines that burn gold near the lamp and fade to steel away from it,
 *   with a thin halo; the shards' tips meet in knots, and the knots near the
 *   lamp flare (the frame's only HDR, so the bloom finds them).
 * - **A band of light sweeps across** (`sweep`): every edge it crosses
 *   glints, gold on a dark page and peach on a light one.
 * - **It dissolves by its own shapes** (`../gpu/dissolve`): each face fades
 *   as a whole by how far it lies from the main knot (`fade`, from the CPU),
 *   and every pixel, haze and all, by the reach's ragged rim, so no side of
 *   the frame ever shows.
 * - **Dark** pages show the light over a navy haze on the page's own ground.
 *   **Light** pages show the glass as the other backdrops show a light page,
 *   a soft wash of ink on the paper: each pane a pale frost, cool away from
 *   the lamp and peach near it, its edges fine periwinkle lines warming toward
 *   the lamp, and the lamp's warmth on the paper round it. It is composed in
 *   the page's own terms (`Grounds`).
 * - **The frame** reads the glass and keeps it quiet under the head's text
 *   (`textScrim`).
 */
import {
  Fn,
  If,
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
import { dissolve, dissolveUniforms } from "../gpu/dissolve";
import { fbm4 } from "../gpu/noise";
import type { textScrim } from "../gpu/text-scrim";
import { FACES } from "./shards";

type F = TslNode<"float">;
type V2 = TslNode<"vec2">;
type V3 = TslNode<"vec3">;

/** The lamp's light, and the glass where the lamp misses it (linear). */
const AMBER = vec3(1.0, 0.5, 0.16);
const GOLD = vec3(1.0, 0.68, 0.34);
const STEEL = vec3(0.14, 0.24, 0.66);
/** A light page's inks: periwinkle edges warming to peach at the lamp, frost panes cool or peach, the lamp's warmth. */
const PERIWINKLE = vec3(0.5, 0.56, 0.9);
const APRICOT = vec3(0.98, 0.56, 0.36);
const FROST = vec3(0.84, 0.87, 0.99);
const PEACH = vec3(1.0, 0.82, 0.68);
const SUNLIT = vec3(1.0, 0.9, 0.78);

/** The way the sweep travels (unit; the scene's `SWEEP_DIR`), and how wide its band is. */
const SWEEP = vec2(0.894, -0.447);
const BAND = 0.11;

const vectors = (n: number) => Array.from({ length: n }, () => new Vector4());

/**
 * Everything the CPU sets. Per face: `corners[2i]` A.xy B.xy, `corners[2i+1]`
 * C.xy depth lit; `edges[i]` AB BC CA fade; `boxes[i]` the box past which
 * nothing of it shows (its halo and its tip's flare included), x0 y0 x1 y1.
 */
export function glassUniforms() {
  /** The per-face values the CPU writes; the arrays below read these very objects. */
  const face = { corners: vectors(FACES * 2), edges: vectors(FACES), boxes: vectors(FACES) };
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
    /** Where the sweeping band of light is, along `SWEEP` (frame units from the centre). */
    sweep: uniform(-9),
    /** How large the composition is: the lamp's reach scales with it. */
    scale: uniform(1),
    /** The frame the glass pass covers: x0, y0, x1, y1. */
    window: uniform(new Vector4(-1, -0.5, 1, 0.5)),
    /** One texel of the glass pass, frame units: the width an edge is antialiased over. */
    pixel: uniform(0.001),
    /** The reach the art dissolves within. */
    reach: dissolveUniforms(),
    corners: uniformArray<"vec4">(face.corners, "vec4"),
    edges: uniformArray<"vec4">(face.edges, "vec4"),
    boxes: uniformArray<"vec4">(face.boxes, "vec4"),
  };
}
export type GlassUniforms = ReturnType<typeof glassUniforms>;

/** Distance from `p` (offset `pa` from the segment's start) to the segment along `e`. */
const segment = (pa: V2, e: V2): F =>
  length(pa.sub(e.mul(clamp(dot(pa, e).div(dot(e, e).add(1e-9)), 0, 1))));

/** How far `p` is inside the edge from a corner along `e` (negative outside), for a face of winding `s`. */
const inside = (pa: V2, e: V2, s: F): F =>
  e.x.mul(pa.y).sub(e.y.mul(pa.x)).mul(s).div(length(e).add(1e-9));

/** What a face's shading reads of the pixel: where it is, and the lamps' and the sweep's light there. */
interface Pixel {
  readonly p: V2;
  readonly reach: F;
  readonly warmth: F;
  readonly glow: F;
  readonly band: F;
}

/** What the faces sum into: the light (dark), what is left of the paper (light), and how much glass. */
interface Sums {
  readonly light: V3;
  readonly paper: V3;
  readonly panes: F;
}

/** Face `i` over a pixel: its light, what it leaves of the paper, and its glass, added into `sums`. */
function shadeFace(
  u: GlassUniforms,
  i: number,
  { p, reach, warmth, glow, band }: Pixel,
  sums: Sums,
) {
  const { light, paper, panes } = sums;
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
  // A face fades as a whole by how far it lies from the main knot.
  const kept = shown.mul(edge.w);
  // One pixel of antialiasing; the far shards out of focus, the farthest most (depth of field).
  const soft = max(u.pixel.mul(0.75), depth.mul(depth).mul(depth).mul(0.022));
  const fill = smoothstep(soft.negate(), soft, depthIn).mul(kept);
  const width = max(u.pixel.mul(0.6), soft.mul(0.35));
  const halo = depth.mul(0.02).add(0.006);
  const lineOf = (d: F, k: F) =>
    k.mul(exp(d.div(width).pow(2).negate()).add(exp(d.div(halo).negate()).mul(0.12)));
  const line = lineOf(segment(pa, e0), edge.x)
    .add(lineOf(segment(pb, e1), edge.y))
    .add(lineOf(segment(pc, e2), edge.z))
    .mul(kept);
  const near = float(1).sub(depth.mul(0.6));
  // Light refracted in from the edges, brightest just inside them.
  const rim = exp(max(depthIn, 0).div(depth.mul(0.03).add(0.012)).negate()).mul(fill);
  // The body is navy glass. A tip near a lamp pours light into its faces, brightest at the tip
  // and in a pane that faces the lamp (transmission); an edge-on pane catches a cool sheen
  // along its edges (Fresnel).
  const toA = a.sub(u.lamp);
  const toA2 = a.sub(u.second);
  const tipLit = exp(dot(toA, toA).div(reach).mul(-5))
    .add(exp(dot(toA2, toA2).div(reach).mul(-8)).mul(0.5))
    .toVar();
  const pour = exp(length(pa).div(u.scale.mul(0.13)).negate())
    .mul(tipLit)
    .toVar();
  const through = warmth
    .mul(lit.mul(0.05).add(0.005))
    .add(pour.mul(lit.mul(1.2).add(0.25)))
    .add(glow.mul(0.01));
  const fresnel = float(1).sub(lit).pow(2);
  const facet = STEEL.mul(lit.mul(0.03).add(0.035))
    .add(AMBER.mul(through))
    .mul(fill)
    .add(mix(STEEL.mul(0.18), AMBER, pour.mul(1.5).min(1)).mul(rim.mul(lit.mul(0.6).add(0.3))))
    .add(STEEL.mul(rim.mul(fresnel).mul(0.22)));
  // An edge burns brightest near its tip and fades along its length.
  const along = exp(length(pa).div(u.scale.mul(0.35)).negate())
    .mul(0.75)
    .add(0.25);
  const edges = mix(STEEL.mul(0.35), GOLD, warmth.mul(warmth).add(pour).add(band).min(1)).mul(
    line.mul(along).mul(lit.mul(0.4).add(0.6)).mul(band.mul(1.6).add(1)),
  );
  // The tips meet in knots; a knot near a lamp flares, a point with a tight halo.
  const toTip = dot(pa, pa);
  const knot = exp(toTip.mul(-9000))
    .add(exp(toTip.mul(-900)).mul(0.25))
    .mul(tipLit)
    .mul(kept)
    .mul(near)
    .mul(0.9);
  panes.addAssign(fill.mul(near));
  light.addAssign(facet.add(edges).mul(near).add(GOLD.mul(knot)).mul(u.heat));
  // A light page: a pane is a pale frost, peach toward the lamp; its edges periwinkle, warming to peach.
  const ink = mix(PERIWINKLE, APRICOT, warmth.add(band).min(1));
  const pane = mix(FROST, PEACH, warmth.mul(lit.mul(0.5).add(0.5)).add(pour).min(1));
  paper.mulAssign(mix(vec3(1, 1, 1), pane, fill.mul(near).mul(0.5).add(rim.mul(0.3))));
  paper.mulAssign(
    mix(vec3(1, 1, 1), ink, min(line.mul(along.add(1)).mul(near).mul(band.mul(0.3).add(0.5)), 0.6)),
  );
}

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
      .add(exp(s2.mul(-12)).mul(0.3))
      .min(1)
      .toVar();
    const core = exp(d2.mul(-40))
      .add(exp(s2.mul(-60)).mul(0.5))
      .toVar();
    const glow = exp(d2.mul(-1.4)).toVar();
    // The sweeping band: every edge it crosses glints.
    const across = dot(p, SWEEP).sub(u.sweep).div(BAND);
    const band = exp(across.mul(across).negate()).toVar();
    const light = vec3(0, 0, 0).toVar();
    const paper = vec3(1, 1, 1).toVar();
    /** How much glass the pixel looks through: the haze lives in the glass, not round it. */
    const panes = float(0).toVar();
    for (let i = 0; i < FACES; i++) {
      // Most faces are nowhere near most pixels: a pixel outside a face's box skips it.
      const box = u.boxes.element(i);
      const within = p.x
        .greaterThan(box.x)
        .and(p.x.lessThan(box.z))
        .and(p.y.greaterThan(box.y))
        .and(p.y.lessThan(box.w));
      If(within, () => shadeFace(u, i, { p, reach, warmth, glow, band }, { light, paper, panes }));
    }
    // The field behind: a navy haze, and the lamp's warmth in the air.
    const haze = fbm4(p.mul(1.4).add(vec2(u.time.mul(0.006), u.time.mul(-0.004))));
    // The haze lives in the glass, thickest where panes overlap near the main knot, so it has
    // their shapes, never one of its own; it and everything else is gone at the reach's ragged rim.
    const fromHub = p.sub(u.hub);
    const gathered = exp(dot(fromHub, fromHub).div(reach).mul(-1.6));
    const left = dissolve(u.reach, p, u.time.mul(0.004));
    const air = vec3(0.011, 0.019, 0.05)
      .mul(haze.mul(0.8).add(0.55).mul(gathered).mul(panes.min(2).mul(0.9).add(0.2)))
      .add(AMBER.mul(warmth.mul(0.035).add(core.mul(0.03)).mul(u.heat)));
    // Where many panes overlap at the lamp the light piles up: roll it off softly, keeping its hue,
    // so the knot glows pale gold rather than burning white.
    const piled = dot(light, vec3(0.2126, 0.7152, 0.0722));
    const lit = light.div(piled.mul(0.3).add(1)).add(air).mul(left);
    const print = mix(
      vec3(1, 1, 1),
      paper.mul(mix(vec3(1, 1, 1), SUNLIT, warmth.mul(0.45).mul(u.heat.min(1.6)))),
      left,
    );
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
    const quiet = scrim.under(vec2(screenUV.x, float(1).sub(screenUV.y))).mul(0.5);
    const lit = ground.add(seen.mul(float(1).sub(quiet)));
    const print = paint(page.mul(mix(seen, vec3(1, 1, 1), quiet)));
    return mix(print, lit, u.dark);
  })();
}
