/**
 * The Astral backdrop: precise celestial instruments drawn as a luminous
 * technical drawing that moves in 3D, the four-point needle star at every
 * scale, in a sky that lives (DESIGN-UI.md → Page-head backdrops → Astral).
 * One scene, its compositions data (`astral.ts`): Movement, Orrery,
 * Planisphere and Armillary, one of them a load, drawn by the page
 * (`GpuLook.variant`); each is composed anew every load. The solids are
 * real (`astral-geometry.ts`), seen through an orthographic camera as a
 * drawing is projected, and cel-shaded: flat bands, inked hairlines, light
 * ink on navy on a dark page and ink and gilt on paper on a light one
 * (`astral-shader.ts`). Depth shows by motion, occlusion, tilt, haze and
 * line weight, never by size.
 *
 * - **Clockwork.** The trains tick in eased steps with a little recoil
 *   (`trainClock`), each wheel by its ratio; a balance swings a little off
 *   the tick, so the two drift in and out of phase; the instrument turns
 *   slowly before the eye on two unrelated periods. Stars breathe on clocks
 *   of their own.
 * - **The sky's rare events** (`ambient`): a shooting star, a constellation
 *   drawing itself and fading, a far train engaging a while, a glint
 *   sweeping the lines.
 * - **The owner.** A write, a move to another page or something noticed
 *   on the page ticks every train one notch at once and flares the hub
 *   star. The pointer is a lamp on an arm: the key swings a little toward
 *   it (attack 0.3 s, release 0.55 s), so the light bands slide across the
 *   plates, and the stars near it glint; nothing else moves.
 * - **Reduced motion** is one still, composed at random as every load is.
 */
import {
  DynamicDrawUsage,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  Object3D,
  PlaneGeometry,
  Quaternion,
  Vector3,
  type BufferGeometry,
  type MeshBasicNodeMaterial,
} from "three/webgpu";
import {
  disposeGraph,
  offscreenPass,
  screenFill,
  type SceneStage,
  type StageFocus,
} from "@kb/scene-gpu";
import { TAU } from "../scene/math";
import type { Reactions } from "../scene/reactions";
import { seededRng } from "../scene/rng";
import { variation } from "../scene/seed";
import {
  mountBackdrop,
  type BackdropLayout,
  type BackdropParts,
  type GpuBackdropInit,
  type GpuBackdropScene,
  type GpuLook,
  type Grounds,
  groundsOf,
} from "../gpu/gpu-scene";
import { textScrim } from "../gpu/text-scrim";
import {
  ASTRAL_VARIANTS,
  CONSTELLATION_POINTS,
  TICK_PERIOD,
  ambient,
  driveAngle,
  isAstralVariant,
  lifeOf,
  trainClock,
  type AmbientKind,
  type AstralVariant,
  type Drive,
  type Happening,
  type Mechanism,
  type Part,
  type StarShape,
  type Train,
} from "./astral";
import { compose } from "./compositions";
import {
  armGeometry,
  armProfile,
  rodGeometry,
  shadowRadius,
  wheelGeometry,
  wheelLayout,
} from "./astral-geometry";
import {
  GLOW,
  KEY_REST,
  NIGHT,
  SHADOWS,
  STAR_REACH,
  STAR_TONES,
  astralUniforms,
  partMaterial,
  setStarBlending,
  starMark,
  starMaterial,
  type AstralUniforms,
  type FigureUniforms,
  type Outline,
} from "./astral-shader";
import { astralSky, slowSky } from "./astral-sky";

/**
 * The camera: orthographic, as a technical drawing is projected, the
 * frame one world unit high at any depth, so world units are frame units;
 * it stands back far enough that every part lies before it.
 */
const PROJECTION = { kind: "orthographic", height: 1 } as const;
const EYE = 4;

/** A composition that names no focus: every depth sharp. */
const UNFOCUSED: StageFocus = { distance: EYE, depth: 0, falloff: 1, radius: 0 };
/** A hairline, in CSS pixels: every inked line is this wide at any pixel ratio. */
const HAIR = 0.3;
/** The bloom on a dark page: small, so a glow is a tight core and never a wash. */
const BLOOM = 0.16;
/** The far train ticks this often while engaged (s). */
const FAR_PERIOD = 0.55;
/** How long the hub's flare takes to fade (s). */
const FLARE_FADE = 0.7;
/** The lamp's response to the pointer: quick to follow, slow to return (s). */
const LAMP_ATTACK = 0.3;
const LAMP_RELEASE = 0.55;
/** The sky's slow fields: how often they are drawn again (s), and their texels per CSS pixel. */
const SLOW_EVERY = 0.25;
const SLOW_TEXEL = 0.5;
/** How far the lamp swings toward the pointer, per frame height it is away. */
const LAMP_REACH = 0.35;
/** When the owner's writes have stirred the scene this much, it is one event; it rearms below `REARM`. */
const STIR_EVENT = 0.35;
const REARM = 0.15;
/** How far a star near the pointer reaches, and how near is near (frame units squared). */
const GLINT = 0.9;
const GLINT_NEAR = 0.004;

/** A part's solid on its own: none for a star or a group. */
function solidOf(part: Part, quality: number): BufferGeometry | null {
  const { shape } = part;
  switch (shape.kind) {
    case "wheel":
      return wheelGeometry(shape, quality);
    case "arm":
      return armGeometry(shape);
    case "rod":
      return rodGeometry(shape);
    case "star":
    case "group":
      return null;
    default:
      return shape satisfies never;
  }
}

/** The outline a part's solid was cut from, which its material inks: none for a star or a group. */
function outlineOf(shape: Part["shape"]): Outline | null {
  switch (shape.kind) {
    case "wheel":
      return { kind: "wheel", layout: wheelLayout(shape) };
    case "arm":
      return { kind: "arm", profile: armProfile(shape) };
    case "rod":
      return { kind: "rod" };
    case "star":
    case "group":
      return null;
    default:
      return shape satisfies never;
  }
}

interface Driven {
  readonly object: Object3D;
  readonly drive: Drive;
  readonly rest: number;
}

interface Placed {
  readonly anchor: Object3D;
  readonly shape: StarShape;
  readonly phases: readonly [number, number];
  readonly rates: readonly [number, number];
}

/** A composition built: its root (the world's frame), the hero placed in it, and what moves. */
interface Built {
  readonly mechanism: Mechanism;
  readonly root: Group;
  /** Placed at the hero's anchor and scaled to it; the stars stand beside it, in the world's frame. */
  readonly hero: Group;
  readonly instrument: Group;
  readonly driven: readonly Driven[];
  /** Front discs that cast a shadow: the object and its radius (own units). */
  readonly casters: readonly { readonly object: Object3D; readonly radius: number }[];
  /** The field's stars, behind what stands before them, then the hub's, over everything. */
  readonly starLayers: readonly StarLayer[];
  readonly dispose: () => void;
}

/** Stars drawn as one instanced mesh: which, and their per-frame `life`. */
interface StarLayer {
  readonly stars: readonly Placed[];
  readonly mesh: InstancedMesh;
  readonly life: InstancedBufferAttribute;
  readonly material: MeshBasicNodeMaterial;
  readonly dispose: () => void;
}

/**
 * Stars as one layer: one instanced quad each, facing the eye; `life` is
 * written each frame (`poseStars`). A layer holding the hub is drawn over
 * everything, as the concepts draw the light source; the field is hidden
 * by what stands before it.
 */
function starLayer(
  stars: readonly Placed[],
  u: AstralUniforms,
  grounds: Grounds,
  quad: PlaneGeometry,
  dark: boolean,
): StarLayer {
  const count = Math.max(1, stars.length);
  const shape = new InstancedBufferAttribute(new Float32Array(count * 4), 4);
  const life = new InstancedBufferAttribute(new Float32Array(count * 4), 4);
  life.setUsage(DynamicDrawUsage);
  stars.forEach((star, i) => {
    shape.setXYZW(
      i,
      STAR_TONES.indexOf(star.shape.tone),
      star.shape.across,
      star.shape.angle,
      star.shape.hub === true ? 1 : 0,
    );
    life.setXYZW(i, 1, 1, 0, 0);
  });
  const material = starMaterial(u, grounds, shape, life);
  setStarBlending(material, dark);
  const front = stars.some((star) => star.shape.hub === true);
  material.depthTest = !front;
  const mesh = new InstancedMesh(quad, material, count);
  mesh.count = stars.length;
  mesh.frustumCulled = false;
  mesh.instanceMatrix.setUsage(DynamicDrawUsage);
  mesh.renderOrder = front ? 3 : 2;
  // A front layer marks its depth where it covers, from the same instances, just before it is drawn.
  const mark = front ? starMark(shape, life) : null;
  if (mark !== null) {
    const marks = new InstancedMesh(quad, mark, count);
    marks.instanceMatrix = mesh.instanceMatrix;
    marks.count = stars.length;
    marks.frustumCulled = false;
    marks.renderOrder = 2.5;
    mesh.add(marks);
  }
  return {
    stars,
    mesh,
    life,
    material,
    dispose: () => {
      material.dispose();
      mark?.dispose();
    },
  };
}

function buildMechanism(
  mechanism: Mechanism,
  u: AstralUniforms,
  grounds: Grounds,
  dark: boolean,
  seed: number,
): Built {
  const root = new Group();
  const hero = new Group();
  const instrument = new Group();
  root.add(hero);
  hero.add(instrument);
  const geometries: BufferGeometry[] = [];
  const materials = new Map<string, MeshBasicNodeMaterial>();
  const driven: Driven[] = [];
  const stars: Placed[] = [];
  const casters: { object: Object3D; radius: number }[] = [];
  const rng = seededRng(seed ^ 0x5a17);

  const materialFor = (part: Part, behind: boolean): MeshBasicNodeMaterial | null => {
    const { shape } = part;
    const outline = outlineOf(shape);
    if (outline === null || shape.kind === "star" || shape.kind === "group") return null;
    const engravings = shape.kind === "wheel" ? shape.engravings : [];
    const key = `${shape.metal}|${behind}|${JSON.stringify(outline)}|${JSON.stringify(engravings)}`;
    let material = materials.get(key);
    if (material === undefined) {
      material = partMaterial(u, grounds, { metal: shape.metal, engravings, outline, behind });
      materials.set(key, material);
    }
    return material;
  };

  // A part set behind the hero's plane, and all it carries, lies in the front parts' shadow.
  const place = (part: Part, parent: Object3D, depth: number, under: boolean) => {
    const behind = under || (depth === 0 && part.at[2] <= -0.1);
    // Posed XYZ: it turns about its own axis first, then takes its tilt.
    const object = new Object3D();
    object.position.set(...part.at);
    const [tx, ty, tz] = part.tilt ?? [0, 0, 0];
    const rest = tz + (part.spin ?? 0);
    object.rotation.set(tx, ty, rest);
    parent.add(object);
    const geometry = solidOf(part, 1);
    const material = materialFor(part, behind);
    if (geometry !== null && material !== null) {
      geometries.push(geometry);
      object.add(new Mesh(geometry, material));
    }
    if (part.drive !== undefined) driven.push({ object, drive: part.drive, rest });
    if (part.shape.kind === "star") {
      stars.push({
        anchor: object,
        shape: part.shape,
        phases: [rng.range(0, TAU), rng.range(0, TAU)],
        rates: [rng.range(0.25, 0.6), rng.range(0.07, 0.18)],
      });
    }
    const { shape } = part;
    if (
      depth === 0 &&
      shape.kind === "wheel" &&
      shape.inner === 0 &&
      shape.radius >= 0.15 &&
      // Only a part on the hero's plane or before it: one behind lies in the shadows.
      !behind &&
      casters.length < SHADOWS
    ) {
      casters.push({ object, radius: shadowRadius(shape) });
    }
    for (const child of part.children ?? []) place(child, object, depth + 1, behind);
  };
  for (const part of mechanism.parts) place(part, instrument, 0, false);

  const quad = new PlaneGeometry(1, 1);
  geometries.push(quad);
  const starLayers = [
    stars.filter((star) => star.shape.hub !== true),
    stars.filter((star) => star.shape.hub === true),
  ].map((layer) => starLayer(layer, u, grounds, quad, dark));
  for (const layer of starLayers) root.add(layer.mesh);

  return {
    mechanism,
    root,
    hero,
    instrument,
    driven,
    casters,
    starLayers,
    dispose: () => {
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials.values()) material.dispose();
      for (const layer of starLayers) layer.dispose();
      root.removeFromParent();
    },
  };
}

/** Eased in and out, 0–1. */
const smooth = (t: number) => {
  const k = Math.min(1, Math.max(0, t));
  return k * k * (3 - 2 * k);
};

/** The points of a constellation drawn from `draw`, away from the instrument and its title. */
function constellationOf(
  happening: Happening,
  hero: { x: number; y: number },
): [number, number, number][] {
  const rng = seededRng(Math.floor(happening.at * 1000) ^ Math.floor(happening.draw * 1e6));
  const side = happening.draw < 0.5 ? -1 : 1;
  let x = hero.x + side * rng.range(0.55, 1.0);
  let y = rng.range(0.16, 0.36);
  let heading = rng.range(0, TAU);
  const points: [number, number, number][] = [];
  const n = rng.int(5, CONSTELLATION_POINTS);
  for (let i = 0; i < n; i++) {
    points.push([x, y, rng.range(0.011, 0.022)]);
    heading += rng.range(-1.2, 1.2);
    const step = rng.range(0.05, 0.085);
    x += step * Math.cos(heading);
    y = Math.min(0.44, Math.max(0.04, y + step * Math.sin(heading)));
  }
  return points;
}

/** A point in the world, on the frame (frame units): the projection is orthographic, so it is the point's x and y. */
const toFrame = (v: Vector3): { readonly x: number; readonly y: number } => ({ x: v.x, y: v.y });

/** Where the hero stands: frame units, and its composition's scale. */
interface Anchor {
  readonly x: number;
  readonly y: number;
  readonly scale: number;
}

const world = new Vector3();

/** Where the front discs' shadows fall: down and to the right of each, softer on the night sky. */
function castShadows(built: Built, u: AstralUniforms, anchor: Anchor, dark: boolean) {
  built.root.updateMatrixWorld(true);
  const unit = built.mechanism.unit * anchor.scale;
  u.casts.forEach((slot, i) => {
    const caster = built.casters[i];
    if (caster === undefined) {
      slot.set(0, 0, 0, 0);
      return;
    }
    caster.object.getWorldPosition(world);
    const at = toFrame(world);
    const r = caster.radius * unit;
    slot.set(at.x + 0.18 * r, at.y - 0.3 * r - 0.012, r * 1.02, dark ? 0.5 : 0.85);
  });
}

/** The hero where `anchor` puts it, and what the shaders read of it: its place, its unit, its sky and its great circle. */
function placeHero(
  built: Built,
  u: AstralUniforms,
  anchor: Anchor,
  setFocus: (focus: StageFocus) => void,
) {
  const { mechanism } = built;
  const unit = mechanism.unit * anchor.scale;
  const { focus } = mechanism;
  // The hero stands on z = 0, the eye EYE before it: the focus in the world's units.
  setFocus(
    focus === undefined
      ? UNFOCUSED
      : {
          distance: EYE - focus.at * unit,
          depth: focus.depth * unit,
          falloff: focus.falloff * unit,
          radius: focus.radius,
        },
  );
  built.hero.position.set(anchor.x, anchor.y, 0);
  built.hero.scale.setScalar(unit);
  u.hero.value.set(anchor.x, anchor.y, anchor.scale, unit);
  u.night.value.set(...(mechanism.sky?.night ?? NIGHT));
  u.glow.value.set(...(mechanism.sky?.glow ?? GLOW));
  const { arc, constellation } = mechanism;
  if (arc === undefined) u.arc.value.set(0, 0, 0, 0);
  else
    u.arc.value.set(anchor.x + arc.at[0] * unit, anchor.y + arc.at[1] * unit, arc.radius * unit, 1);
  const at = (x: number, y: number) => [anchor.x + x * unit, anchor.y + y * unit] as const;
  drawFigure(
    u.figure,
    constellation.stars.map(([x, y, size]) => [...at(x, y), size * unit, 1] as const),
    constellation.links.map(([from, to]) => {
      const [x0, y0] = constellation.stars[from] ?? [0, 0];
      const [x1, y1] = constellation.stars[to] ?? [0, 0];
      return [...at(x0, y0), ...at(x1, y1)] as const;
    }),
    1,
  );
}

type FigureStar = readonly [x: number, y: number, size: number, shown: number];
type FigureLink = readonly [x0: number, y0: number, x1: number, y1: number];

/**
 * A constellation into `f` (frame units): its stars, its links as far as
 * they have drawn, how strongly the links show, and the box it all lies in
 * (an empty one when nothing shows).
 */
function drawFigure(
  f: FigureUniforms,
  stars: readonly FigureStar[],
  links: readonly FigureLink[],
  shown: number,
) {
  const box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  const cover = (x: number, y: number, reach: number) => {
    box.x0 = Math.min(box.x0, x - reach);
    box.y0 = Math.min(box.y0, y - reach);
    box.x1 = Math.max(box.x1, x + reach);
    box.y1 = Math.max(box.y1, y + reach);
  };
  f.stars.forEach((slot, i) => {
    const star = stars[i];
    if (star === undefined || star[3] <= 0) slot.set(0, 0, 0, 0);
    else {
      slot.set(...star);
      cover(star[0], star[1], star[2] + 0.012);
    }
  });
  f.links.forEach((slot, i) => {
    const link = links[i];
    if (link === undefined || shown <= 0) slot.set(0, 0, 0, 0);
    else {
      slot.set(...link);
      cover(link[0], link[1], 0.004);
      cover(link[2], link[3], 0.004);
    }
  });
  f.shown.value = shown;
  if (box.x0 === Infinity) f.bounds.value.set(0, 0, 0, 0);
  else f.bounds.value.set(box.x0, box.y0, box.x1, box.y1);
}

/** The instrument at `time`: the eye's drift round it, every drive at its angle. */
function poseInstrument(
  built: Built,
  time: number,
  ticks: (train: Train, every: number) => number,
  phases: readonly [number, number],
) {
  const { mechanism, instrument, driven } = built;
  // The eye drifts round the instrument on two unrelated periods.
  const wave = (period: number, phase: number) =>
    0.62 * Math.sin((TAU * time) / period + phase) +
    0.38 * Math.sin((TAU * time) / (period * 1.618) + phase * 1.7);
  instrument.rotation.set(
    mechanism.lean[0] + mechanism.drift.pitch * wave(mechanism.drift.period, phases[0]),
    mechanism.lean[1] + mechanism.drift.yaw * wave(mechanism.drift.period * 1.31, phases[1]),
    mechanism.lean[2],
  );
  for (const { object, drive, rest } of driven) {
    object.rotation.z = rest + driveAngle(drive, ticks, time);
  }
  built.root.updateMatrixWorld(true);
}

/** The pointer over the frame (frame units) and how near it is; at rest, over the hero and not near. */
interface Over {
  readonly x: number;
  readonly y: number;
  readonly near: number;
}

const aim = new Vector3();
const reachOut = new Vector3();

/** The lamp on its arm, swung toward the pointer: quick to follow, slow to return. */
function swingLamp(lamp: Vector3, over: Over, anchor: Anchor, dt: number) {
  reachOut.set(
    (over.x - anchor.x) * LAMP_REACH * over.near,
    (over.y - anchor.y) * LAMP_REACH * over.near,
    0,
  );
  aim.copy(KEY_REST).add(reachOut).normalize();
  if (dt <= 0) return;
  const toward = aim.distanceToSquared(KEY_REST) > lamp.distanceToSquared(KEY_REST);
  lamp.lerp(aim, 1 - Math.exp(-dt / (toward ? LAMP_ATTACK : LAMP_RELEASE))).normalize();
}

const scale = new Vector3();
const matrix = new Matrix4();
const facing = new Quaternion();

/** The stars: each faces the eye where its part carries it, breathing, glinting near the pointer, the hub flaring. */
function poseStars(built: Built, time: number, over: Over, flare: number, anchor: Anchor) {
  for (const layer of built.starLayers)
    poseLayer(layer, built.mechanism.unit * anchor.scale, time, over, flare);
}

function poseLayer(
  { stars, mesh, life }: StarLayer,
  unit: number,
  time: number,
  over: Over,
  flare: number,
) {
  stars.forEach((star, i) => {
    star.anchor.getWorldPosition(world);
    const at = toFrame(world);
    const d2 = (at.x - over.x) ** 2 + (at.y - over.y) ** 2;
    const glint = over.near * Math.exp(-d2 / GLINT_NEAR);
    const breath =
      0.86 +
      0.09 * Math.sin(time * star.rates[0] + star.phases[0]) +
      0.05 * Math.sin(time * star.rates[1] + star.phases[1]);
    const hub = star.shape.hub === true;
    const bright = breath * (1 + 0.8 * glint) * (hub ? 1 + 1.6 * flare : 1);
    const reach = (1 + GLINT * glint) * (hub ? 1 + 0.45 * flare : 1);
    life.setXYZW(i, bright, reach, 0, 0);
    const size = star.shape.size * unit * 2 * STAR_REACH;
    scale.set(size, size, size);
    matrix.compose(world, facing, scale);
    mesh.setMatrixAt(i, matrix);
  });
  life.needsUpdate = true;
  mesh.instanceMatrix.needsUpdate = true;
}

/** The sky's rare events as the shader reads them: a glint sweep, a shooting star, a constellation. */
function skyEvents(u: AstralUniforms, anchor: Anchor) {
  let formedAt = -1;
  let points: [number, number, number][] = [];
  const sweep = (glint: Happening | undefined, time: number) => {
    if (glint === undefined) {
      u.sweep.value.set(-9, 0, 0);
      return;
    }
    const l = lifeOf(glint, time);
    const span = 1.4 * anchor.scale;
    const across = anchor.x - span + 2 * span * smooth(l);
    u.sweep.value.set(across, Math.sin(Math.PI * l) ** 1.5, 0);
  };
  const shoot = (shot: Happening | undefined, time: number) => {
    if (shot === undefined) {
      u.shooting.value.set(0, 0, 0, 0);
      return;
    }
    const l = lifeOf(shot, time);
    const d = shot.draw;
    const heading = -0.32 - 0.38 * ((d * 13) % 1);
    const x0 = anchor.x + (-1.7 + 2.3 * d) * Math.max(0.7, anchor.scale);
    const y0 = 0.47 - 0.12 * ((d * 7) % 1);
    const run = 0.9 * (1 - (1 - l) ** 2);
    const head = [x0 + run * Math.cos(heading), y0 + run * Math.sin(heading)] as const;
    u.shooting.value.set(head[0], head[1], heading, Math.max(1e-3, l));
  };
  const form = (forming: Happening | undefined, time: number) => {
    if (forming === undefined) {
      drawFigure(u.forming, [], [], 0);
      return;
    }
    if (forming.at !== formedAt) {
      formedAt = forming.at;
      points = constellationOf(forming, anchor);
    }
    const l = lifeOf(forming, time);
    const fade = 1 - smooth((l - 0.72) / 0.28);
    // Its stars appear one by one, then its links draw from each star to the next.
    const drawn = smooth((l - 0.28) / 0.22) * (points.length - 1);
    drawFigure(
      u.forming,
      points.map(([x, y, size], i) => [x, y, size, smooth((l - 0.03 - i * 0.035) / 0.06) * fade]),
      points.slice(1).map(([x1, y1], i) => {
        const [x0, y0] = points[i] ?? [x1, y1];
        const g = Math.min(1, Math.max(0, drawn - i));
        return [x0, y0, x0 + (x1 - x0) * g, y0 + (y1 - y0) * g];
      }),
      fade,
    );
  };
  return {
    show: (under: Readonly<Partial<Record<AmbientKind, Happening>>>, time: number) => {
      sweep(under.glint, time);
      shoot(under.shootingStar, time);
      form(under.constellation, time);
    },
    /** The hero moved: the next constellation is drawn about where it stands. */
    follow: (next: Anchor) => {
      anchor = next;
    },
  };
}

/** What the owner did, as one event: a write (once its stir passes a mark), a page change, something noticed. */
function ownerEvents() {
  let armed = true;
  let navigated = Infinity;
  let noticed = 0;
  return (reactions: Reactions): boolean => {
    let event = false;
    if (armed && reactions.stir > STIR_EVENT) {
      armed = false;
      event = true;
    } else if (!armed && reactions.stir < REARM) armed = true;
    const since = reactions.sinceNavigate();
    if (since < navigated) event = true;
    navigated = since;
    if (reactions.noticed.count !== noticed) {
      noticed = reactions.noticed.count;
      event = true;
    }
    return event;
  };
}

/** The sky's slow fields (`slowSky`): soft, a texel about every other CSS pixel, drawn again a few times a second and on a new layout. */
function slowFields(stage: SceneStage, u: AstralUniforms) {
  const pass = offscreenPass(stage.renderer, () => slowSky(u), { history: false });
  let since = Infinity;
  return {
    picture: pass.picture,
    layout: ({ width, height }: BackdropLayout) => {
      pass.setSize(width * SLOW_TEXEL, height * SLOW_TEXEL);
      since = Infinity;
    },
    frame: (dt: number) => {
      since += dt;
      if (since < SLOW_EVERY && dt > 0) return;
      pass.render();
      since = 0;
    },
    dispose: () => pass.dispose(),
  };
}

function astral(stage: SceneStage, init: GpuBackdropInit): BackdropParts {
  const vary = variation(init.seed);
  const scrim = textScrim();
  const u = astralUniforms();
  const grounds = groundsOf(stage);
  const slow = slowFields(stage, u);
  // The sky fills the frame on a quad: the orthographic view is wider than three's background sphere.
  const backdrop = screenFill(astralSky(u, { scrim, slow: slow.picture }, grounds));
  stage.scene.add(backdrop);
  stage.camera.position.set(0, 0, EYE);
  u.eye.value = EYE;
  stage.camera.lookAt(0, 0, 0);

  let dark = init.dark;
  const variantOf = (look: GpuLook): AstralVariant =>
    isAstralVariant(look.variant) ? look.variant : vary.pick("variant", ASTRAL_VARIANTS);
  const make = (variant: AstralVariant) => {
    const made = buildMechanism(compose(variant, vary), u, grounds, dark, init.seed);
    stage.scene.add(made.root);
    return made;
  };
  let built = make(variantOf(init));

  // A still is composed as a load is; a moving scene starts somewhere of its own.
  const start = vary.range("clock", 30, 600);
  let time = start;
  const main = trainClock(TICK_PERIOD, start);
  const far = trainClock(FAR_PERIOD, 0);
  let farTime = 0;
  const sky = ambient(vary.stream, start);
  const ticks = (train: Train, every: number) => (train === "main" ? main : far).position(every);
  const phases = [vary.phase("drift.a"), vary.phase("drift.b")] as const;
  let size = { width: 1, height: 1 };
  let anchor: Anchor = { x: 0, y: 0, scale: 1 };
  let flare = 0;
  const lamp = KEY_REST.clone();
  const events = skyEvents(u, anchor);
  const heard = ownerEvents();

  const place = () => placeHero(built, u, anchor, stage.setFocus);
  const pose = (dt: number, reactions: Reactions | null) => {
    poseInstrument(built, time, ticks, phases);
    const pointer = reactions?.pointer;
    const over: Over = pointer
      ? {
          x: (pointer.x - size.width / 2) / size.height,
          y: (size.height / 2 - pointer.y) / size.height,
          near: pointer.near,
        }
      : { x: anchor.x, y: anchor.y, near: 0 };
    u.pointer.value.set(over.x, over.y, over.near);
    swingLamp(lamp, over, anchor, dt);
    u.key.value.copy(lamp);
    poseStars(built, time, over, flare, anchor);
    castShadows(built, u, anchor, dark);
  };

  return {
    // In a panel the instrument is smaller, high and right, quieter; wide, right of the title.
    get panel() {
      return { ...built.mechanism.panel, presence: 0.9 };
    },
    get wide() {
      return { ...built.mechanism.wide, presence: 1 };
    },
    layout: (layout: BackdropLayout) => {
      size = { width: layout.width, height: layout.height };
      anchor = layout.anchor;
      events.follow(anchor);
      place();
      u.detail.value = layout.quality;
      u.hair.value = HAIR * stage.renderer.getPixelRatio();
      slow.layout(layout);
      scrim.layout(layout);
      pose(0, null);
      return anchor;
    },
    setLook: (look: GpuLook) => {
      dark = look.dark;
      u.dark.value = dark ? 1 : 0;
      stage.setBloom(dark ? BLOOM : 0.03);
      const variant = variantOf(look);
      if (variant !== built.mechanism.variant) {
        built.dispose();
        built = make(variant);
        place();
        pose(0, null);
      }
      for (const layer of built.starLayers) setStarBlending(layer.material, dark);
      castShadows(built, u, anchor, dark);
    },
    frame: (dt: number, reactions: Reactions) => {
      time += dt;
      if (dt > 0 && heard(reactions)) {
        main.notch();
        flare = 1;
      }
      flare *= Math.exp(-dt / FLARE_FADE);
      main.advance(time);
      const under = sky.at(time);
      // The far train engages while its event lasts, easing in and out by its ticks.
      if (under.farTrain !== undefined) {
        farTime += dt;
        far.advance(farTime);
      }
      events.show(under, time);
      u.time.value = time;
      u.flare.value = flare;
      slow.frame(dt);
      pose(dt, reactions);
    },
    dispose: () => {
      built.dispose();
      slow.dispose();
      disposeGraph(backdrop);
    },
  };
}

export function mountAstral(host: HTMLElement, init: GpuBackdropInit): Promise<GpuBackdropScene> {
  return mountBackdrop(
    host,
    init,
    {
      // A little bloom, close: the stars' cores glow, their spikes stay sharp, nothing washes.
      bloom: { strength: BLOOM, radius: 0.08 },
      projection: PROJECTION,
      // Each composition focuses its own way (`Mechanism.focus`), set as the hero is placed.
      focus: UNFOCUSED,
      // A camera's finish: fine grain. No split: a drawn line stays one colour to the frame's edge.
      lens: { aberration: 0, streak: 0, grain: 0.015 },
      fadeSpace: "display",
      // The sky spans the scroll region; it fades into the page low in the frame and a little at the top.
      feather: { sides: 0, top: 0.05, bottom: 0.3 },
    },
    astral,
  );
}
