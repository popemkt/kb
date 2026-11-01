/**
 * Depth of field (`StageOptions.focus`): a surface is sharp near the focal
 * plane and softens as it lies further before or behind it, as a lens
 * focused on that plane draws it.
 *
 * - **The circle of confusion** is a pixel's distance from the plane in
 *   view depth (world units), read from the scene pass's depth through the
 *   stage's own projection (linear for an orthographic one), so it holds
 *   for either. A pixel with no surface (the cleared depth: a backdrop's
 *   sky, drawn after the solids on the far plane) is in focus, since such a
 *   sky draws its own detail.
 * - **A gather in two strokes**, across then down (a lens's blur is
 *   round and soft, so it parts into two lines of taps, smooth where a
 *   sparse disc would leave grain on a fine line): each tap counted where
 *   its own circle reaches the pixel, so a blurred part spreads over what
 *   lies behind it; a tap behind the pixel counts no wider than the
 *   pixel's own circle, so nothing behind bleeds over a sharp part in
 *   front.
 * - **At half the frame's pixels**, then laid over the sharp picture: a
 *   blur only spreads, so a quarter of the pixels carry it, and a pixel
 *   keeps its own sharp colour unless its circle, or that of a part in
 *   front of it near enough to spread over it, reaches past a pixel. So
 *   the front layer stays as crisp as it was drawn.
 * - The gather is drawn once a frame, before the bloom; the laying over
 *   is read wherever the stage reads its picture (`sample`), so the
 *   bloom and the composite read the same picture and no frame-sized
 *   texture is written for it. A stage focused nowhere (radius 0) draws
 *   none of it and reads its picture as it is.
 */
import {
  Fn,
  If,
  abs,
  clamp,
  convertToTexture,
  exp,
  float,
  ivec2,
  min,
  mix,
  orthographicDepthToViewZ,
  perspectiveDepthToViewZ,
  screenCoordinate,
  screenSize,
  screenUV,
  sign,
  step,
  uniform,
  vec2,
  vec4,
} from "three/tsl";
import type { TextureNode } from "three/webgpu";
import type { Projection } from "./stage";
import type { TslNode } from "./tsl";

/** Where a stage focuses, and how quickly it loses focus either side. */
export interface StageFocus {
  /** The focal plane's distance from the camera (world units). */
  readonly distance: number;
  /** How far before or behind the plane a surface stays sharp (world units). */
  readonly depth: number;
  /** How much further it takes to blur fully (world units). */
  readonly falloff: number;
  /** The widest blur: its circle's radius in CSS pixels. */
  readonly radius: number;
}

/** Taps either side of a pixel in each stroke of the gather; with the pixel's own, nine. */
const REACH = 4;

/** The gather's share of the frame's pixels across and down. */
const SHARE = 0.5;

/** Where the sharp picture looks for a part in front spreading over it: a ring of this many. */
const NEAR = 8;

/** The far plane's depth, less a hair: a pixel at it holds no surface. */
const CLEARED = 0.99999;

/** Where a pixel with no surface stands: behind every surface, with no circle of its own. */
const SKY = 16384;

/** A signed mark's circle: its size, and none for a pixel with no surface. */
const circleOf = (signed: TslNode<"float">) => abs(signed).mul(step(abs(signed), SKY / 2));

/**
 * One stroke of the gather over `from` (colour, and each pixel's signed
 * circle), along `along` (a unit step in the gather's pixels), `reach`
 * gather pixels either side; `carry` is what it passes on beside the
 * colour, from the pixel's own mark.
 */
function stroke(
  from: TextureNode,
  along: readonly [number, number],
  reach: TslNode<"float">,
  carry: (own: TslNode<"float">) => TslNode<"float">,
) {
  return Fn(() => {
    const at = screenCoordinate.xy;
    // Exact texels, never filtered: a blend of a surface's mark and the sky's means neither.
    const own = from.load(ivec2(at)).toVar();
    const last = screenSize.sub(1);
    const sum = own.rgb.toVar();
    const weight = float(1).toVar();
    const ownCircle = circleOf(own.a).mul(SHARE);
    for (let k = -REACH; k <= REACH; k++) {
      if (k === 0) continue;
      const offset = reach.mul(k / REACH);
      // Clamped to the frame: a load outside it reads nothing defined.
      const tap = from.load(
        ivec2(clamp(at.add(vec2(along[0], along[1]).mul(offset)), vec2(0, 0), last)),
      );
      // A tap behind this pixel spreads no wider over it than this pixel's own circle.
      const behind = step(own.a, tap.a);
      const circle = circleOf(tap.a).mul(SHARE);
      const spread = mix(circle, min(circle, ownCircle), behind);
      // Whole where its circle reaches, and soft toward the circle's edge, as a lens's is.
      const reached = clamp(spread.sub(abs(offset)).add(0.5), 0, 1);
      const w = reached.mul(exp(offset.div(spread.max(1e-3)).pow(2).mul(-1.5)));
      sum.addAssign(tap.rgb.mul(w));
      weight.addAssign(w);
    }
    return vec4(sum.div(weight), carry(own.a));
  })();
}

/**
 * How wide a nearer part's circle spreads over a pixel of the gather: a
 * ring of loads in `field`, `reach` gather pixels out, each counted only
 * in front of the pixel (`own`, its mark).
 */
function spreadNear(field: TextureNode, reach: TslNode<"float">, own: TslNode<"float">) {
  const at = screenCoordinate.xy;
  const last = screenSize.sub(1);
  let cover: TslNode<"float"> = float(0);
  for (let i = 0; i < NEAR; i++) {
    const t = (i / NEAR) * Math.PI * 2;
    const tap = field.load(
      ivec2(clamp(at.add(vec2(Math.cos(t), Math.sin(t)).mul(reach)), vec2(0, 0), last)),
    ).a;
    cover = cover.max(circleOf(tap).mul(step(tap, own)));
  }
  return cover;
}

/**
 * `picture` softened by depth (`depth`, the same pass's), as the stage's
 * camera (`projection`, its clip range `near`–`far`) sees it, focused as
 * `focus` asks: `sample` reads it. `set` retunes the focus; `scale` is the
 * frame's pixel ratio.
 */
export function depthOfField(
  picture: TextureNode,
  depth: TextureNode,
  projection: Projection,
  [near, far]: readonly [number, number],
  focus: StageFocus,
) {
  const knobs = {
    distance: uniform(focus.distance),
    depth: uniform(focus.depth),
    falloff: uniform(focus.falloff),
    radius: uniform(focus.radius),
    scale: uniform(1),
  };
  const toViewZ =
    projection.kind === "orthographic" ? orthographicDepthToViewZ : perspectiveDepthToViewZ;
  /** A pixel's circle (device pixels of the frame) at `uv`, signed by its side of the plane, behind positive; `SKY` where no surface is. */
  const signedAt = (uv: TslNode<"vec2">) => {
    const d = depth.sample(uv).r;
    const off = toViewZ(d, float(near), float(far)).negate().sub(knobs.distance);
    // As a lens's: growing in step with the distance past the sharp band.
    const circle = clamp(abs(off).sub(knobs.depth).div(knobs.falloff.max(1e-6)), 0, 1).mul(
      knobs.radius.mul(knobs.scale),
    );
    return mix(float(SKY), circle.max(1e-3).mul(sign(off)), step(d, CLEARED));
  };
  // Each pixel's colour and its circle, read once, so each tap of the gather is one read.
  const field = convertToTexture(
    vec4(picture.sample(screenUV).rgb, signedAt(screenUV)),
    null,
    null,
    {
      resolutionScale: SHARE,
    },
  );
  // Across, carrying each pixel's mark; then down, carrying how far a nearer part spreads over it.
  const reach = knobs.radius.mul(knobs.scale).mul(SHARE);
  const across = convertToTexture(
    stroke(field, [1, 0], reach, (own) => own),
    null,
    null,
    {
      resolutionScale: SHARE,
    },
  );
  const soft = convertToTexture(
    stroke(across, [0, 1], reach, (own) => spreadNear(field, reach.mul(0.7), own)),
    null,
    null,
    { resolutionScale: SHARE },
  );
  const passes = [field, across, soft];
  // Focused somewhere or nowhere: nowhere draws none of the passes and reads the picture as it is.
  const engaged = uniform(0);
  const engage = (radius: number) => {
    engaged.value = radius > 0 ? 1 : 0;
    for (const p of passes) p.autoUpdate = radius > 0;
  };
  engage(focus.radius);
  return {
    /**
     * The picture at `uv`: sharp, softened where a circle reaches past a
     * pixel, its own (from the frame's own depth, so an edge in focus stays
     * as crisp as it was drawn) or a nearer part's spreading over it.
     */
    sample: (uv: TslNode<"vec2">) =>
      Fn(() => {
        const seen = picture.sample(uv).toVar();
        // Focused nowhere, the picture is read as it is: no depth, no gather.
        If(engaged.greaterThan(0), () => {
          const blurred = soft.sample(uv);
          const cover = clamp(circleOf(signedAt(uv)).max(blurred.a).sub(0.5), 0, 1);
          seen.assign(mix(seen, vec4(blurred.rgb, 1), cover));
        });
        return seen;
      })(),
    dispose: () => {
      for (const p of passes) p.dispose();
    },
    set: (next: StageFocus) => {
      knobs.distance.value = next.distance;
      knobs.depth.value = next.depth;
      knobs.falloff.value = next.falloff;
      knobs.radius.value = next.radius;
      engage(next.radius);
    },
    scale: (ratio: number) => {
      knobs.scale.value = ratio;
    },
  };
}
