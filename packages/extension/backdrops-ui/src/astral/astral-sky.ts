/**
 * Astral's sky (T1), behind the instrument (`astral-shader.ts` shades the
 * parts and the stars), with its dark look and its light one chosen by
 * `dark`.
 *
 * - **On a dark page** ink-navy pooled about the instrument, a slow nebula,
 *   a field of tiny stars and four-point glints (lengthening near the
 *   pointer), a few soft bokeh orbs, a graduated great circle turning very
 *   slowly (`arc`) and the composition's constellation, far and faint
 *   (`figure`). **On a light one** warm paper with its fibres, printed
 *   specks and marks, the great circle and the constellation in ink, and
 *   the instrument's soft cast shadow.
 * - **The rare events**: a shooting star, and a constellation drawing
 *   itself and fading (`forming`), drawn as the composition's is.
 */
import {
  Fn,
  If,
  abs,
  atan,
  clamp,
  cos,
  dot,
  exp,
  float,
  floor,
  fract,
  length,
  max,
  mix,
  pow,
  screenSize,
  screenUV,
  sin,
  smoothstep,
  step,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import type { PictureSampler, TslNode } from "@kb/scene-gpu";
import type { Grounds } from "../gpu/gpu-scene";
import type { textScrim } from "../gpu/text-scrim";
import { fbm4, gnoise, hash, hash2 } from "../gpu/noise";
import { CONSTELLATION_LINKS, CONSTELLATION_POINTS } from "./astral";
import {
  GILT,
  INK,
  contact,
  frameAt,
  spike,
  type AstralUniforms,
  type F,
  type FigureUniforms,
  type V2,
  type V3,
} from "./astral-shader";

/**
 * A small four-point glint in the sky at `off` from its centre, its long
 * spike `size` frame units: a hard core, crisp spikes and a small halo.
 */
function glintAt(off: V2, size: F, px: F): F {
  const waist = size.mul(0.06).max(px.mul(0.7));
  const r = length(off);
  return spike(off.y, off.x, size, waist, px)
    .add(spike(off.x, off.y, size.mul(0.58), waist, px))
    .add(smoothstep(px.mul(1.6), px.mul(0.6), r).mul(1.4))
    .add(exp(r.div(size.mul(0.2)).pow(2).negate()).mul(0.12));
}

/** Distance from `p` to the segment `a`–`b`. */
function segment(p: V2, a: V2, b: V2): F {
  const ab = b.sub(a);
  const t = clamp(dot(p.sub(a), ab).div(dot(ab, ab).max(1e-6)), 0, 1);
  return length(p.sub(a.add(ab.mul(t))));
}

/** Tiny stars, one to a cell, each breathing on its own clock. */
function tinyStars(p: V2, px: F, t: F): F {
  const id = floor(p.div(0.036));
  const h = hash2(id.add(3.7));
  const at = id.add(h.mul(0.7).add(0.15)).mul(0.036);
  const d = length(p.sub(at)).toVar();
  const shown = float(0).toVar();
  // A star reaches a few pixels: the rest of its cell is dark.
  If(d.lessThan(px.mul(3)), () => {
    const bright = pow(hash(id.add(11.3)), 7)
      .mul(0.9)
      .add(hash(id.add(1.9)).mul(0.06));
    const breathe = sin(t.mul(hash(id.add(5.1)).mul(1.5).add(0.4)).add(h.x.mul(6.283)))
      .mul(0.25)
      .add(0.75);
    shown.assign(
      exp(d.div(px.mul(0.85)).pow(2).negate())
        .mul(bright)
        .mul(breathe),
    );
  });
  return shown;
}

/** Four-point glints, a few to a broad cell, lengthening and brightening near the pointer. */
function glintField(u: AstralUniforms, p: V2, px: F, t: F): F {
  const glints = float(0).toVar();
  const cell = 0.22;
  // A glint reaches less than half a cell, so the four cells nearest the pixel hold every one that reaches it.
  const home = floor(p.div(cell).sub(0.5));
  for (let i = 0; i <= 1; i++) {
    for (let j = 0; j <= 1; j++) {
      const gid = home.add(vec2(i, j));
      const g = hash2(gid.add(17.1));
      const centre = gid.add(g.mul(0.5).add(0.25)).mul(cell);
      const shows = step(hash(gid.add(29.3)), 0.42);
      const toward = centre.sub(u.pointer.xy);
      const near = exp(dot(toward, toward).div(0.012).negate()).mul(u.pointer.z);
      const size = mix(float(0.006), float(0.026), pow(hash(gid.add(41.7)), 2.2)).mul(
        near.mul(1.3).add(1),
      );
      const off = p.sub(centre).toVar();
      // Drawn only where it reaches: a glint is small and the sky is wide.
      If(shows.greaterThan(0).and(max(abs(off.x), abs(off.y)).lessThan(size.mul(1.05))), () => {
        const own = sin(t.mul(mix(float(0.15), float(0.5), g.y)).add(g.x.mul(6.283)))
          .mul(0.3)
          .add(0.7);
        glints.addAssign(glintAt(off, size, px).mul(own).mul(near.mul(1.4).add(0.55)));
      });
    }
  }
  return glints;
}

/** A hairline ring of radius `r` about `at`. */
const ringAt = (p: V2, at: V2, r: F, px: F): F =>
  exp(length(p.sub(at)).sub(r).div(px.mul(0.6)).pow(2).negate());

/**
 * A constellation (`FigureUniforms`): its stars as four-point glints, each
 * in a small hairline ring, joined by hairlines.
 */
function constellationAt(f: FigureUniforms, p: V2, px: F): F {
  const stars = float(0).toVar();
  const ring = float(0.006).max(px.mul(3));
  for (let i = 0; i < CONSTELLATION_POINTS; i++) {
    const star = f.starArray.element(i);
    const off = p.sub(star.xy).toVar();
    // Drawn only where its spikes or its ring reach.
    const reach = star.z.mul(1.05).max(ring.add(px.mul(3)));
    If(star.w.greaterThan(0).and(max(abs(off.x), abs(off.y)).lessThan(reach)), () => {
      stars.addAssign(
        glintAt(off, star.z, px)
          .add(ringAt(p, star.xy, ring, px).mul(0.14))
          .mul(star.w.mul(0.7)),
      );
    });
  }
  const links = float(0).toVar();
  for (let i = 0; i < CONSTELLATION_LINKS; i++) {
    const link = f.linkArray.element(i);
    const drawnSoFar = step(1e-5, length(link.zw.sub(link.xy)));
    links.addAssign(
      exp(segment(p, link.xy, link.zw).div(px.mul(0.6)).pow(2).negate()).mul(drawnSoFar),
    );
  }
  return stars.add(links.mul(f.shown).mul(0.08));
}

/** A constellation where `p` lies in its box, and nothing elsewhere. */
function figureAt(f: FigureUniforms, p: V2, px: F): F {
  const drawn = float(0).toVar();
  const box = f.bounds;
  If(
    p.x
      .greaterThan(box.x)
      .and(p.x.lessThan(box.z))
      .and(p.y.greaterThan(box.y))
      .and(p.y.lessThan(box.w)),
    () => {
      drawn.assign(constellationAt(f, p, px));
    },
  );
  return drawn;
}

/** A shooting star: a fine streak behind its head, in and out over its life. */
function shootingStar(u: AstralUniforms, p: V2, px: F): F {
  const shot = u.shooting;
  const heading = vec2(cos(shot.z), sin(shot.z));
  const q = p.sub(shot.xy);
  const ahead = dot(q, heading);
  const aside = dot(q, vec2(heading.y.negate(), heading.x));
  const seen = sin(shot.w.mul(Math.PI)).max(0).pow(0.7).mul(step(0.0001, shot.w));
  const tail = exp(ahead.div(0.06))
    .mul(step(ahead, 0))
    .mul(smoothstep(-0.26, -0.02, ahead));
  return exp(aside.div(px.mul(0.9)).pow(2).negate())
    .mul(tail)
    .add(exp(length(q).div(px.mul(2.2)).pow(2).negate()).mul(1.6))
    .mul(seen);
}

/**
 * Bokeh: a few out-of-focus orbs to the frame, drifting very slowly, each
 * a lens's blur of a far light: a disc with a soft edge, a little brighter
 * toward its rim, its own size (the larger, the fainter) and a faint tint
 * between ice and warm.
 */
function bokehAt(p: V2, t: F): V3 {
  const cell = 0.8;
  const drift = p.add(vec2(t.mul(0.0025), t.mul(0.001)));
  const home = floor(drift.div(cell).sub(0.5));
  const orbs = vec3(0, 0, 0).toVar();
  // An orb reaches less than a quarter cell, so the four nearest cells hold every one that reaches the pixel.
  for (let i = 0; i <= 1; i++) {
    for (let j = 0; j <= 1; j++) {
      const id = home.add(vec2(i, j));
      const h = hash2(id.add(51.3));
      const centre = id.add(h.mul(0.5).add(0.25)).mul(cell);
      const size = pow(hash(id.add(7.1)), 1.4);
      const radius = mix(float(0.03), float(0.07), size);
      // Out of focus: the edge as soft as a fifth of the disc, the rim a little brighter than the middle.
      const soft = radius.mul(0.22).add(0.003);
      const d = length(drift.sub(centre)).toVar();
      const shown = step(hash(id.add(13.7)), 0.45).mul(mix(float(1), float(0.6), size));
      // Drawn only where it reaches.
      If(shown.greaterThan(0).and(d.lessThan(radius.add(soft))), () => {
        const disc = smoothstep(radius.add(soft.mul(0.5)), radius.sub(soft), d);
        const rim = smoothstep(radius.mul(0.35), radius.sub(soft.mul(0.4)), d);
        const tint = mix(vec3(0.7, 0.8, 1), vec3(1, 0.88, 0.7), hash(id.add(23.9)).mul(0.6));
        orbs.addAssign(tint.mul(disc.mul(rim.mul(0.45).add(0.5))).mul(shown));
      });
    }
  }
  return orbs;
}

/** Ticks on the sky's great circle: this many to a turn, every tenth a major one. */
const ARC_TICKS = 720;

/** The sky's graduated great circle: two hairline rings and a scale between them, turning very slowly. */
function arcAt(u: AstralUniforms, p: V2, px: F): F {
  const arc = u.arc;
  const q = p.sub(arc.xy);
  const d = length(q).sub(arc.z).toVar();
  const width = arc.z.mul(0.0075).toVar();
  const drawn = float(0).toVar();
  If(arc.z.greaterThan(0).and(abs(d.add(width.mul(0.5))).lessThan(width.add(px.mul(3)))), () => {
    const rings = exp(d.div(px.mul(0.7)).pow(2).negate()).add(
      exp(d.add(width).div(px.mul(0.6)).pow(2).negate()).mul(0.7),
    );
    const n = atan(q.y, q.x)
      .add(u.time.mul(0.0015))
      .mul(ARC_TICKS / (Math.PI * 2));
    const index = floor(n.add(0.5));
    const off = n
      .sub(index)
      .mul((Math.PI * 2) / ARC_TICKS)
      .mul(arc.z);
    const major = step(fract(index.div(10).add(0.05)), 0.1);
    const reach = mix(width.mul(0.45), width, major);
    const tick = exp(off.div(px.mul(0.6)).pow(2).negate())
      .mul(step(d.negate(), reach))
      .mul(step(d, 0));
    drawn.assign(rings.add(tick.mul(0.8)));
  });
  return drawn;
}

/**
 * The sky's slow fields, drawn offscreen at a share of the frame's pixels a
 * few times a second (`offscreenPass`), since they change over minutes: the
 * nebula and the warmth about the hub on a dark page (x, y), the paper's
 * fibre on a light one (z).
 */
export function slowSky(u: AstralUniforms): TslNode<"vec4"> {
  return Fn(() => {
    const p = frameAt().toVar();
    const t = u.time;
    const nebula = fbm4(p.mul(1.3).add(vec2(t.mul(0.003), 4.1)));
    const warm = gnoise(p.mul(3.1).add(vec2(7.3, t.mul(-0.004))));
    const fibre = gnoise(p.mul(vec2(46, 4)).add(3.3))
      .sub(0.5)
      .mul(0.02)
      .add(fbm4(p.mul(7)).sub(0.5).mul(0.035));
    return vec4(nebula, warm, fibre, 1);
  })();
}

/** The sky, for `scene.backgroundNode`. Only the page's look is drawn, and a rare event only while it is under way. */
export function astralSky(
  u: AstralUniforms,
  { scrim, slow }: { readonly scrim: ReturnType<typeof textScrim>; readonly slow: PictureSampler },
  { ground, page, paint }: Grounds,
): V3 {
  return Fn(() => {
    const p = frameAt().toVar();
    const field = slow(vec2(screenUV.x, float(1).sub(screenUV.y))).toVar();
    const px = float(1).div(screenSize.y).toVar();
    const off = p.sub(u.hero.xy).div(u.hero.z.max(0.3));
    const d2 = dot(off, off).toVar();
    const under = scrim.under(vec2(screenUV.x, float(1).sub(screenUV.y)));
    const open = float(1).sub(under.mul(0.75)).toVar();
    const t = u.time;
    // The instrument's shadow on the sky: the ground of a dark page, the paper of a light one.
    const lit = contact(u, p).toVar();
    const tiny = tinyStars(p, px, t).toVar();
    // The glints are the detail a slow frame gives up first.
    const glints = float(0).toVar();
    If(u.detail.greaterThan(0.72), () => {
      glints.assign(glintField(u, p, px, t));
    });
    const drawn = figureAt(u.figure, p, px)
      .add(figureAt(u.forming, p, px))
      .toVar();
    const streak = float(0).toVar();
    If(u.shooting.w.greaterThan(0), () => {
      streak.assign(shootingStar(u, p, px));
    });
    const arc = arcAt(u, p, px).mul(open).toVar();
    const shown = vec3(0, 0, 0).toVar();

    If(u.dark.greaterThan(0.5), () => {
      // Dark: the composition's night pooled about the instrument, a slow nebula, its glow at the hub.
      const nebula = field.x;
      const warm = field.y;
      // The hub's light: close and bright, and a broad faint haze about the instrument.
      const hub = u.glow
        .mul(exp(d2.div(-0.06)).add(exp(d2.div(-0.5)).mul(0.35)))
        .mul(u.flare.mul(1.5).add(1));
      const glow = smoothstep(0.45, 0.85, warm.mul(0.5).add(nebula.mul(0.5))).mul(
        exp(d2.div(-0.7)),
      );
      const sky = u.night
        .mul(exp(d2.div(-1.4)).mul(1.0).add(0.22))
        // The nebula is the night's own colour, thickened: a darker night, a fainter nebula.
        .add(u.night.mul(1.25).mul(smoothstep(0.42, 0.85, nebula)))
        .add(vec3(0.018, 0.012, 0.005).mul(glow))
        .add(hub)
        .add(bokehAt(p, t).mul(0.08));
      const lights = vec3(0.78, 0.82, 0.92)
        .mul(tiny)
        .add(vec3(0.86, 0.82, 0.74).mul(glints.mul(0.9)))
        .add(vec3(0.95, 0.82, 0.58).mul(drawn))
        .add(vec3(0.95, 0.92, 0.86).mul(streak))
        .add(vec3(0.5, 0.44, 0.32).mul(arc.mul(0.3)))
        .mul(open);
      shown.assign(ground.add(sky.add(lights).mul(lit.mul(0.65).add(0.35))));
    }).Else(() => {
      // Light: warm paper, its fibres, light pooled at the instrument; printed specks and marks; the cast shadow.
      const fibre = field.z;
      const pooled = exp(d2.div(-2.4)).mul(0.035).sub(0.02);
      const shade = float(1).add(fibre).add(pooled).mul(lit.mul(0.2).add(0.8));
      const ink = tiny
        .mul(2.2)
        .add(glints.mul(1.0))
        .add(drawn.mul(0.9))
        .add(arc.mul(0.3))
        .mul(open)
        .min(0.9);
      const paper = page.mul(vec3(0.975, 0.94, 0.86)).mul(shade);
      const printed = mix(paper, INK.mul(1.6), ink);
      const gilded = mix(printed, GILT, streak.min(1).mul(0.85));
      shown.assign(paint(gilded));
    });
    return shown;
  })();
}
