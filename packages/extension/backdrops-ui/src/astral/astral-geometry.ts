/**
 * Astral's parts as solids (`astral.ts` says what they are): a wheel is its
 * outline (teeth or a plain rim) with its spokes' windows or its bore cut
 * out, extruded to its thickness with a fine bevel; an arm is a tapered
 * rule, a rod a cylinder. Every flat part lies in its own XY plane, its
 * axis +z, its thickness centred on it: the shader reads its face in those
 * coordinates (`astral-shader.ts`).
 *
 * A part's outline is stated once, here (`wheelLayout`, `armProfile`): the
 * solid is cut from it, and the shader inks the face's edge from the same
 * numbers, so the line lies on the solid's edge at any angle.
 */
import { type BufferGeometry, CylinderGeometry, ExtrudeGeometry, Path, Shape } from "three/webgpu";
import { TAU } from "../scene/math";
import type { ArmShape, RodShape, WheelShape } from "./astral";

/** How many segments a whole circle of radius `r` is drawn with: finer the larger, never coarse. */
const segmentsFor = (r: number, quality: number) =>
  Math.max(24, Math.round(Math.min(220, 140 * Math.sqrt(r)) * quality));

/** A tooth's height for `teeth` on pitch radius `r`: about its pitch, never deep. */
const toothDepth = (r: number, teeth: number) => Math.min(0.06, ((TAU * r) / teeth) * 1.05);

/**
 * A tooth's profile over its pitch (0–1 from a gap's centre): where its
 * flank leaves the root, reaches the tip, leaves it and meets the root again.
 */
export const TOOTH = { rise: 0.29, tip: 0.38, fall: 0.62, root: 0.71 } as const;

/** A wheel's outline: its teeth (or a plain rim), its spokes' windows or its bore, all radii in its own units. */
export interface WheelLayout {
  readonly teeth: number;
  /** The rim's outer edge without teeth; with them, the tips and the roots. */
  readonly tip: number;
  readonly root: number;
  /** The spokes' windows: between the hub and the rim, each spoke `spoke` wide; none when `spokes` is 0. */
  readonly spokes: number;
  readonly hub: number;
  readonly rim: number;
  readonly spoke: number;
  /** A bore's radius; 0, none. */
  readonly inner: number;
}

/** The outline of `shape`, as its solid is cut and its face is inked. */
export function wheelLayout(shape: WheelShape): WheelLayout {
  const depth = shape.teeth > 0 ? toothDepth(shape.radius, shape.teeth) : 0;
  const windows = shape.inner === 0 && shape.spokes > 0;
  return {
    teeth: shape.teeth,
    tip: shape.radius + depth / 2,
    root: shape.radius - depth / 2,
    spokes: windows ? shape.spokes : 0,
    hub: Math.max(0.045, shape.radius * 0.12),
    rim: shape.radius - depth - Math.max(0.03, shape.radius * 0.07),
    spoke: Math.max(0.014, shape.radius * 0.035),
    inner: shape.inner,
  };
}

/** The disc a wheel's contact shadow takes: its pitch circle with teeth, else just past its rim's inside. */
export const shadowRadius = (shape: WheelShape) =>
  shape.teeth > 0 ? shape.radius : wheelLayout(shape).rim + 0.03;

/** The outline of a toothed rim: trapezoid teeth about the pitch circle, counter-clockwise. */
function teethOutline(shape: Shape, { teeth, tip: outer, root }: WheelLayout) {
  const step = TAU / teeth;
  // Root, flank up, tip, flank down: a tooth's profile, as a fraction of its pitch.
  const profile = [
    [0, root],
    [TOOTH.rise, root],
    [TOOTH.tip, outer],
    [TOOTH.fall, outer],
    [TOOTH.root, root],
  ] as const;
  let first = true;
  for (let i = 0; i < teeth; i++) {
    for (const [frac, rr] of profile) {
      const t = (i + frac) * step;
      const x = rr * Math.cos(t);
      const y = rr * Math.sin(t);
      if (first) shape.moveTo(x, y);
      else shape.lineTo(x, y);
      first = false;
    }
  }
  shape.closePath();
}

/** A circle as a path (a hole runs clockwise). */
function circle(path: Path, r: number, segments: number, clockwise: boolean) {
  for (let i = 0; i <= segments; i++) {
    const t = ((clockwise ? -i : i) / segments) * TAU;
    const x = r * Math.cos(t);
    const y = r * Math.sin(t);
    if (i === 0) path.moveTo(x, y);
    else path.lineTo(x, y);
  }
}

/** The window between two spokes: an annular sector, clockwise, the spokes' width left either side. */
function spokeWindow(
  [from, to]: readonly [number, number],
  {
    inner,
    outer,
    spoke,
    segments,
  }: { inner: number; outer: number; spoke: number; segments: number },
) {
  const path = new Path();
  const outerSkip = spoke / 2 / outer;
  const innerSkip = spoke / 2 / inner;
  const a0 = from + outerSkip;
  const a1 = to - outerSkip;
  const b0 = from + innerSkip;
  const b1 = to - innerSkip;
  const n = Math.max(6, Math.round((segments * (a1 - a0)) / TAU));
  path.moveTo(inner * Math.cos(b0), inner * Math.sin(b0));
  for (let i = 0; i <= n; i++) {
    const t = b0 + ((b1 - b0) * i) / n;
    path.lineTo(inner * Math.cos(t), inner * Math.sin(t));
  }
  for (let i = 0; i <= n; i++) {
    const t = a1 - ((a1 - a0) * i) / n;
    path.lineTo(outer * Math.cos(t), outer * Math.sin(t));
  }
  path.closePath();
  return path;
}

/** A wheel as a solid: its rim, teeth, spokes or bore; its face in XY, its thickness about z = 0. */
export function wheelGeometry(shape: WheelShape, quality: number): BufferGeometry {
  const segments = segmentsFor(shape.radius, quality);
  const layout = wheelLayout(shape);
  const outline = new Shape();
  if (layout.teeth > 0) teethOutline(outline, layout);
  else circle(outline, layout.tip, segments, false);
  if (layout.inner > 0) {
    const bore = new Path();
    circle(bore, layout.inner, segments, true);
    outline.holes.push(bore);
  }
  for (let i = 0; i < layout.spokes; i++) {
    outline.holes.push(
      spokeWindow([(i / layout.spokes) * TAU, ((i + 1) / layout.spokes) * TAU], {
        inner: layout.hub,
        outer: layout.rim,
        spoke: layout.spoke,
        segments,
      }),
    );
  }
  const bevel = Math.min(0.012, shape.thickness * 0.3);
  const geometry = new ExtrudeGeometry(outline, {
    depth: Math.max(0.001, shape.thickness - 2 * bevel),
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: Math.min(0.006, shape.radius * 0.02),
    bevelSegments: quality > 0.6 ? 3 : 2,
    curveSegments: 1,
  });
  geometry.translate(0, 0, -shape.thickness / 2 + bevel);
  return geometry;
}

/**
 * An arm's outline: its half-width at each station along it, from its tail
 * (-x) through its pivot to its tip (+x); the outline is symmetric about x.
 */
export function armProfile(shape: ArmShape): readonly (readonly [number, number])[] {
  const w = shape.width / 2;
  const tail = shape.tail > 0 ? shape.tail : w;
  return [
    [-tail, w * (shape.tail > 0 ? 0.45 : 0.5)],
    [-w * 2.2, w * 0.8],
    [0, w],
    [w * 2.2, w * 0.75],
    [shape.length, w * 0.18],
  ];
}

/** An arm: a rule tapering from its pivot to a fine tip (+x), and to its tail (-x). */
export function armGeometry(shape: ArmShape): BufferGeometry {
  const w = shape.width / 2;
  const profile = armProfile(shape);
  const outline = new Shape();
  profile.toReversed().forEach(([x, y], i) => {
    if (i === 0) outline.moveTo(x, y);
    else outline.lineTo(x, y);
  });
  for (const [x, y] of profile) outline.lineTo(x, -y);
  outline.closePath();
  const bevel = Math.min(0.006, shape.thickness * 0.3);
  const geometry = new ExtrudeGeometry(outline, {
    depth: Math.max(0.001, shape.thickness - 2 * bevel),
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: Math.min(0.003, w * 0.4),
    bevelSegments: 2,
  });
  geometry.translate(0, 0, -shape.thickness / 2 + bevel);
  return geometry;
}

/** A rod along +y from its foot. */
export function rodGeometry(shape: RodShape): BufferGeometry {
  const geometry = new CylinderGeometry(shape.radius, shape.radius, Math.abs(shape.length), 14, 1);
  geometry.translate(0, shape.length / 2, 0);
  return geometry;
}
