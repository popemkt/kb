/**
 * The wolf medallion's circle and its far glyphs (`medallion-shader.ts`
 * draws them in its field): two fine rings broken into arcs, the glyphs
 * between them, one to a slot, read from the glyph atlas
 * (`../gpu/glyph-atlas`), and glyph haze across the frame. A glyph is
 * whoever drew it, kb's runes or the art setting's, each in its own colour.
 */
import {
  abs,
  atan,
  cos,
  dFdx,
  dFdy,
  float,
  floor,
  fract,
  fwidth,
  length,
  max,
  mix,
  sin,
  smoothstep,
  vec2,
  vec3,
} from "three/tsl";
import type { TslNode } from "@kb/scene-gpu";
import { hash, hash2 } from "../gpu/noise";
import { TAU } from "../scene/math";
import { CIRCLE } from "./medallion";
import type { MedallionUniforms } from "./medallion-shader";

type F = TslNode<"float">;
type V2 = TslNode<"vec2">;
type V3 = TslNode<"vec3">;

/** `q` turned by `angle` (rad). */
export const turned = (q: V2, angle: F | number): V2 => {
  const c = cos(angle);
  const s = sin(angle);
  return vec2(q.x.mul(c).sub(q.y.mul(s)), q.x.mul(s).add(q.y.mul(c)));
};

/**
 * A glyph's light on a dark page is light first and colour second, as if
 * leaking from a groove: a warm pale white (`GLYPH_WHITE`) faintly tinted
 * by its colour, a little in its stroke and more in its soft glow
 * (`GLYPH_TINT`); how much of the glow its light carries beside its
 * stroke, and how bright both are.
 */
const GLYPH_WHITE = vec3(1, 0.86, 0.66);
const GLYPH_TINT = { stroke: 0.12, glow: 0.45 } as const;
const GLYPH_GLOW = 0.8;
const GLYPH_LIGHT = 1.1;
export const LUMA = vec3(0.2126, 0.7152, 0.0722);
/**
 * A glyph's light on a dark page for its colour `hue`, `tint` of the way
 * from the warm white toward it; the colour taken at its own brightest, so
 * a deep violet tints as much as a pale gold and the light is evened.
 */
const glyphLight = (hue: V3, tint: F | number): V3 =>
  mix(GLYPH_WHITE, hue.div(max(hue.x, max(hue.y, hue.z)).max(1e-3)), tint).mul(GLYPH_LIGHT);

/**
 * The circle's glyphs at `q` (medallion units, the circle turned with it):
 * the slot `q` falls in, one to each glyph evenly round the circle (the
 * first at the top), and that glyph read from the atlas over the pixel's
 * footprint, its stroke and its glow, its top outward; each breathes on a
 * slow clock of its own and flickers faintly, never in step. Its light, and
 * its colour.
 */
function circleGlyphs(u: MedallionUniforms, q: V2, time: F) {
  const n = u.glyphs.count;
  const slot = floor(
    fract(
      atan(q.y, q.x)
        .sub(TAU / 4)
        .div(TAU)
        .add(float(0.5).div(n)),
    ).mul(n),
  ).toVar();
  const at = slot
    .mul(TAU)
    .div(n)
    .add(TAU / 4)
    .toVar();
  const centre = vec2(cos(at), sin(at)).mul(CIRCLE.glyphs);
  const upright = float(TAU / 4).sub(at);
  const toLocal = (v: V2): V2 => turned(v, upright).div(CIRCLE.glyph);
  const read = u.glyphs.read(slot, toLocal(q.sub(centre)), toLocal(dFdx(q)), toLocal(dFdy(q)));
  const breath = sin(time.mul(slot.mul(0.13).add(0.35)).add(slot.mul(2.1)))
    .mul(0.4)
    .add(0.62);
  const flicker = sin(time.mul(5.3).add(slot.mul(4.7)))
    .mul(sin(time.mul(1.7).add(slot.mul(1.3))))
    .mul(0.08)
    .add(1);
  const shine = breath.mul(flicker);
  const hue = u.glyphs.color(slot).toVar();
  const glow = read.y.mul(GLYPH_GLOW);
  return {
    lit: read.x.add(glow).mul(shine),
    light: glyphLight(hue, GLYPH_TINT.stroke)
      .mul(read.x)
      .add(glyphLight(hue, GLYPH_TINT.glow).mul(glow))
      .mul(shine),
    hue,
  };
}

/** The far glyphs: one to a cell this wide (frame units), this tall, and how far from the medallion they keep (its radii). */
const FAR_GLYPH = { cell: 1.15, size: [0.07, 0.11], clear: [2.2, 3.2] } as const;
/**
 * Glyph haze: faint glyphs far behind the smoke across the frame, one to a
 * cell, each one of the circle's, a little turned, out of focus (the
 * atlas's glow, never its stroke), breathing on a slow clock of its own and
 * rising a little; each fades whole by where it stands, and keeps clear of
 * the medallion's own circle. How much there is, and its light (`tint`),
 * as the circle's glow is lit.
 */
export function glyphHaze(u: MedallionUniforms, p: V2) {
  const home = floor(p.x.div(FAR_GLYPH.cell));
  let amount: F = float(0);
  let tint: V3 = vec3(0, 0, 0);
  for (let k = -1; k <= 1; k++) {
    const cell = home.add(k);
    const h = hash2(vec2(cell, 61.7));
    const own = hash(vec2(cell, 3.3));
    const size = mix(float(FAR_GLYPH.size[0]), float(FAR_GLYPH.size[1]), own);
    const rise = fract(u.time.mul(0.004).add(own));
    const centre = vec2(
      cell.add(h.x.mul(0.6).add(0.2)).mul(FAR_GLYPH.cell),
      mix(float(-0.05), float(0.36), h.y).add(rise.mul(0.06)),
    );
    const toLocal = (v: V2): V2 => turned(v, own.sub(0.5).mul(0.6)).div(size);
    const pick = floor(hash(vec2(cell, 19.1)).mul(u.glyphs.count));
    const read = u.glyphs.read(pick, toLocal(p.sub(centre)), toLocal(dFdx(p)), toLocal(dFdy(p)));
    const away = length(centre.sub(u.centre)).div(u.radius);
    const breath = sin(u.time.mul(0.2).add(own.mul(TAU)))
      .mul(0.35)
      .add(0.65);
    const shown = u.field
      .standing(centre, hash(vec2(cell, 29.5)))
      .mul(smoothstep(FAR_GLYPH.clear[0], FAR_GLYPH.clear[1], away))
      .mul(rise.mul(TAU / 2).sin());
    const lit = read.y.mul(breath).mul(shown);
    amount = amount.add(lit);
    tint = tint.add(glyphLight(u.glyphs.color(pick), GLYPH_TINT.glow).mul(lit));
  }
  return { amount, tint };
}

/** The rings' half width (medallion units). */
const RING_HALF = 0.0045;

/**
 * A line `half` wide either side, at a distance `d` from it: covered by how
 * much of the pixel's footprint lies within it, so it is antialiased at
 * device pixels however large or small it is drawn, never stepped or soft.
 */
function hairline(d: F, half: number): F {
  const w = fwidth(d).max(1e-5).mul(0.75);
  return smoothstep(w.add(half), float(half).sub(w), d);
}

/**
 * The circle behind the medallion at `q` (medallion units, `r` from its
 * centre): two rings broken into arcs (`rings`), and the glyphs, turning,
 * each breathing (`glyphs`, how much of each is drawn; `light`, its light
 * on a dark page; `hue`, its colour).
 */
export function circleAt(u: MedallionUniforms, q: V2, r: F) {
  const spun = turned(q, u.turn.negate()).toVar();
  const angle = atan(spun.y, spun.x).div(TAU).add(0.5);
  const arcs = (n: number, phase: number, gap: number) => {
    const g = fract(angle.mul(n).add(phase));
    return smoothstep(0, 0.015, g).mul(smoothstep(gap, gap - 0.015, g));
  };
  const ring = hairline(abs(r.sub(CIRCLE.inner)), RING_HALF)
    .mul(arcs(5, 0.05, 0.86))
    .add(hairline(abs(r.sub(CIRCLE.outer)), RING_HALF).mul(arcs(8, 0.3, 0.9)));
  const along = sin(angle.mul(TAU * 3).add(u.time.mul(0.25)))
    .mul(0.3)
    .add(0.55);
  const { lit, light, hue } = circleGlyphs(u, spun, u.time);
  return { glyphs: lit, light, hue, rings: ring.mul(along).mul(0.5) };
}
