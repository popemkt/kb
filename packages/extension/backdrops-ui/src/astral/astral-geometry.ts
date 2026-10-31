/**
 * Astral's parts as solids (`astral.ts` says what they are): a wheel is its
 * outline (teeth or a plain rim) with its spokes' windows or its bore cut
 * out, extruded to its thickness with a fine bevel, so its edges catch the
 * light as a hairline; an arm is a tapered rule, a rod a cylinder. Every
 * flat part lies in its own XY plane, its
 * axis +z, its thickness centred on it: the shader reads its face in those
 * coordinates (`astral-shader.ts`).
 */
import { type BufferGeometry, CylinderGeometry, ExtrudeGeometry, Path, Shape } from "three/webgpu";
import { TAU } from "../scene/math";
import type { ArmShape, RodShape, WheelShape } from "./astral";

/** How many segments a whole circle of radius `r` is drawn with: finer the larger, never coarse. */
const segmentsFor = (r: number, quality: number) =>
  Math.max(24, Math.round(Math.min(220, 140 * Math.sqrt(r)) * quality));

/** A tooth's height for `teeth` on pitch radius `r`: about its pitch, never deep. */
const toothDepth = (r: number, teeth: number) => Math.min(0.06, ((TAU * r) / teeth) * 1.05);

/** The outline of a toothed rim: trapezoid teeth about the pitch circle, counter-clockwise. */
function teethOutline(shape: Shape, r: number, teeth: number) {
  const depth = toothDepth(r, teeth);
  const outer = r + depth / 2;
  const root = r - depth / 2;
  const step = TAU / teeth;
  // Root, flank up, tip, flank down: a tooth's profile, as a fraction of its pitch.
  const profile = [
    [0, root],
    [0.29, root],
    [0.38, outer],
    [0.62, outer],
    [0.71, root],
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

/** The rim's inside, where the spokes' windows end: a band in from the teeth's roots. */
export const rimOf = (shape: WheelShape) =>
  shape.radius -
  (shape.teeth > 0 ? toothDepth(shape.radius, shape.teeth) : 0) -
  Math.max(0.035, shape.radius * 0.1);

/** A wheel as a solid: its rim, teeth, spokes or bore; its face in XY, its thickness about z = 0. */
export function wheelGeometry(shape: WheelShape, quality: number): BufferGeometry {
  const segments = segmentsFor(shape.radius, quality);
  const outline = new Shape();
  if (shape.teeth > 0) teethOutline(outline, shape.radius, shape.teeth);
  else circle(outline, shape.radius, segments, false);
  if (shape.inner > 0) {
    const bore = new Path();
    circle(bore, shape.inner, segments, true);
    outline.holes.push(bore);
  } else if (shape.spokes > 0) {
    const rim = rimOf(shape);
    const hub = Math.max(0.05, shape.radius * 0.18);
    const spoke = Math.max(0.018, shape.radius * 0.07);
    for (let i = 0; i < shape.spokes; i++) {
      outline.holes.push(
        spokeWindow([(i / shape.spokes) * TAU, ((i + 1) / shape.spokes) * TAU], {
          inner: hub,
          outer: rim,
          spoke,
          segments,
        }),
      );
    }
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

/** An arm: a rule tapering from its pivot to a fine tip (+x), and to its tail (-x). */
export function armGeometry(shape: ArmShape): BufferGeometry {
  const w = shape.width / 2;
  const outline = new Shape();
  const tail = shape.tail > 0 ? shape.tail : w;
  outline.moveTo(shape.length, w * 0.18);
  outline.lineTo(w * 2.2, w * 0.75);
  outline.lineTo(0, w);
  outline.lineTo(-w * 2.2, w * 0.8);
  outline.lineTo(-tail, w * (shape.tail > 0 ? 0.45 : 0.5));
  outline.lineTo(-tail, -w * (shape.tail > 0 ? 0.45 : 0.5));
  outline.lineTo(-w * 2.2, -w * 0.8);
  outline.lineTo(0, -w);
  outline.lineTo(w * 2.2, -w * 0.75);
  outline.lineTo(shape.length, -w * 0.18);
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
