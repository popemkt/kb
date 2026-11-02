/**
 * The Disc field's shaders (the picture: `disc-field.ts`): every disc of the
 * cloud as one instanced sprite, and the ground it is painted on.
 *
 * - **A disc** is a flat colour, hard-edged: its edge is antialiased by
 *   alpha to coverage over the scene pass's multisampling, never blurred.
 *   Discs overlap by depth alone, the nearest whole, as paint dabbed on.
 * - **Its size** is a random draw (most small, a few large) times
 *   perspective, never under a floor of device pixels (the far field stays
 *   covered) nor over a share of the frame.
 * - **The silhouette** (`silhouette`): a noise-warped ellipse about the
 *   hero, in frame units. Inside it every disc lives; across its spray
 *   band discs drop out at random thresholds and shrink, and beyond it a
 *   few specks are left: the painting dissolves into the page by its own
 *   discs, never by a fade.
 * - **Under the head's text** (`textScrim`) discs are smaller and paler.
 * - **Colour**: the baked colour, hazed toward the page with distance and
 *   toward it again across the spray; a dark page grades the painting as
 *   every painted scene (`darkGrade`). Both pass through the stage's
 *   `paint`, so the page shows the colours as authored.
 */
import {
  cameraProjectionMatrix,
  clamp,
  float,
  fract,
  instancedBufferAttribute,
  length,
  max,
  min,
  mix,
  modelViewMatrix,
  pow,
  screenUV,
  sin,
  cos,
  smoothstep,
  step,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import {
  InstancedBufferAttribute,
  Sprite,
  SpriteNodeMaterial,
  Vector2,
  Vector3,
  Vector4,
} from "three/webgpu";
import type { TslNode } from "@kb/scene-gpu";
import type { Grounds } from "../gpu/gpu-scene";
import { darkGrade } from "../gpu/dark-grade";
import { gnoise } from "../gpu/noise";
import type { textScrim } from "../gpu/text-scrim";
import type { DiscCloud } from "./disc-field";

type F = TslNode<"float">;
type V2 = TslNode<"vec2">;
type V3 = TslNode<"vec3">;

/** The cream wash a light page lays under the painting, as the paper under paint. */
const WASH = [0.97, 0.9, 0.74] as const;

export function discUniforms() {
  return {
    time: uniform(0),
    /** 1 while it moves, 0 for the still. */
    motion: uniform(1),
    /** A write's breath of wind through the leaves, 0–1. */
    gust: uniform(0),
    dark: uniform(0),
    /** The frame's width over its height. */
    aspect: uniform(1),
    /** The hero's centre (frame units, y up) and its scale. */
    hero: uniform(new Vector3(0, 0, 1)),
    /** The silhouette's radii, in heights at scale 1. */
    shape: uniform(new Vector2(0.9, 0.36)),
    /** Where the spray starts (`e`), its width, how many specks lie past it, and how far noise warps it. */
    edge: uniform(new Vector4(0.84, 0.32, 0.45, 0.42)),
    /** A disc's least and greatest diameter (world units) and how strongly the draw favours small ones. */
    size: uniform(new Vector3(0.024, 0.3, 3.1)),
    /** Device pixels per world unit at distance 1, the least disc and the greatest (device pixels). */
    pixels: uniform(new Vector3(1000, 1.9, 64)),
    /** The frame's height in device pixels. */
    frame: uniform(720),
    /** How much distance hazes toward the page, from where to where. */
    haze: uniform(new Vector3(0.62, 14, 150)),
  };
}

export type DiscUniforms = ReturnType<typeof discUniforms>;

/** How far out `p` (frame units, y up) lies on the silhouette's ellipse: 1 at its rim. */
const reach = (u: DiscUniforms, p: V2): F => length(p.sub(u.hero.xy).div(u.shape.mul(u.hero.z)));

/** 1 inside the silhouette at distance `e`, falling to 0 across the spray band. */
const insideAt = (u: DiscUniforms, e: F): F =>
  clamp(float(1).sub(e.sub(u.edge.x).div(max(u.edge.y, 0.001))), 0, 1);

/**
 * The silhouette at `p` (frame units, y up): the ellipse's distance warped
 * by drifting noise (`e`), so its edge is ragged, and how far inside it is.
 */
function silhouette(u: DiscUniforms, p: V2): { readonly e: F; readonly inside: F } {
  const drift = vec2(u.time.mul(0.012), u.time.mul(-0.008));
  const warp = gnoise(p.mul(2.6).add(drift))
    .add(gnoise(p.mul(7.1).sub(drift)).mul(0.5))
    .sub(0.75);
  const e = reach(u, p).add(warp.mul(u.edge.w));
  return { e, inside: insideAt(u, e) };
}

const linear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

/** The cloud as a sprite whose instances are its discs. */
export function discSprite(
  u: DiscUniforms,
  cloud: DiscCloud,
  scrim: ReturnType<typeof textScrim>,
  { page, paint }: Grounds,
): Sprite {
  const place = instancedBufferAttribute<"vec3">(new InstancedBufferAttribute(cloud.place, 3));
  const draw = instancedBufferAttribute<"vec4">(new InstancedBufferAttribute(cloud.draw, 4));
  const sway = instancedBufferAttribute<"float">(new InstancedBufferAttribute(cloud.sway, 1));
  const colours = instancedBufferAttribute<"vec3">(
    new InstancedBufferAttribute(cloud.colour.map(linear), 3),
  );

  // The leaves stir: a few slow, unrelated motions per disc, deeper while a write's wind passes.
  const phase = draw.w.mul(Math.PI * 2);
  const t = u.time;
  const stir = sway.mul(u.motion).mul(u.gust.mul(2.2).add(1));
  const moved = place.add(
    vec3(
      sin(t.mul(0.9).add(place.z.mul(0.7)).add(phase)).mul(0.05),
      sin(t.mul(1.3).add(place.x.mul(0.9)).add(phase)).mul(0.03),
      cos(t.mul(0.7).add(place.x.mul(0.5)).add(phase)).mul(0.04),
    ).mul(stir),
  );
  const view = modelViewMatrix.mul(vec4(moved, 1));
  const away = max(view.z.negate(), 0.01);
  const clip = cameraProjectionMatrix.mul(view);
  const ndc = clip.xy.div(clip.w);
  const p = vec2(ndc.x.mul(u.aspect), ndc.y).mul(0.5);
  const { e, inside } = silhouette(u, p);
  const under = scrim.under(ndc.mul(0.5).add(0.5));

  // Its size in device pixels: the draw, perspective, the floor, a little breathing.
  const diameter = mix(u.size.x, u.size.y, pow(draw.x, u.size.z));
  const breathe = sin(t.mul(1.7).add(phase.mul(3)))
    .mul(0.07)
    .mul(u.motion)
    .add(1);
  const drawn = max(diameter.mul(u.pixels.x).div(away), u.pixels.y.mul(draw.x.mul(0.8).add(0.6)));
  // In the body every disc; across the spray fewer and smaller; past it, specks.
  const body = step(draw.z, pow(inside, 1.4));
  const band = u.edge.z
    .mul(clamp(float(1).sub(e.sub(u.edge.x).div(u.edge.y.mul(2.2).add(0.001))), 0, 1))
    .mul(float(1).sub(body))
    // Specks fall: few over the painting's crown, most about its foot.
    .mul(clamp(float(0.5).sub(p.y.sub(u.hero.y).div(u.shape.y.mul(u.hero.z))), 0.2, 1));
  const speck = step(fract(draw.z.mul(17.31).add(draw.w.mul(7.7))), band);
  const speckPx = u.frame.mul(draw.y.mul(0.005).add(0.003));
  const calm = float(1).sub(under.mul(0.45));
  const px = min(
    drawn.mul(breathe).mul(body).mul(inside.mul(0.7).add(0.3)).add(speck.mul(speckPx)).mul(calm),
    u.pixels.z,
  );
  // Under a pixel it is not drawn at all.
  const shown = step(0.9, px);

  const baked = mix(colours, darkGrade(colours, page), u.dark);
  const hazed = u.haze.x.mul(smoothstep(u.haze.y, u.haze.z, away));
  const toPage = max(hazed, float(1).sub(inside).mul(0.45)).max(under.mul(0.4));
  const colour = paint(mix(baked, page, toPage)).toVertexStage();

  const material = new SpriteNodeMaterial({ transparent: false, depthWrite: true });
  material.positionNode = moved;
  material.scaleNode = px.mul(shown).mul(away).div(u.pixels.x);
  material.colorNode = colour;
  // Opaque but for the rim: alpha crosses the test at the disc's edge, and coverage antialiases it.
  material.opacityNode = float(1).sub(length(uv().sub(0.5)));
  material.alphaTest = 0.5;
  material.alphaToCoverage = true;
  const sprite = new Sprite(material);
  sprite.count = cloud.count;
  sprite.frustumCulled = false;
  return sprite;
}

/**
 * The ground the discs are painted on: the page, a cream wash under the
 * painting on a light one. The wash is soft, so it follows the ellipse
 * unwarped: no noise is read for every pixel of the frame.
 */
export function discGround(u: DiscUniforms, { page, paint }: Grounds): V3 {
  const at = vec2(screenUV.x, float(1).sub(screenUV.y));
  const inside = insideAt(u, reach(u, at.sub(0.5).mul(vec2(u.aspect, 1))));
  const wash = mix(page.mul(vec3(...WASH)), page, u.dark);
  return paint(mix(page, wash, inside.mul(inside).mul(0.45)));
}
