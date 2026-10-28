/**
 * The Arena's scene (ART-DIRECTION.md → YoRHa → Arena): the play
 * (`arena-sim.ts`) drawn with the scene kit (`@kb/scene-gpu`) as a hacking
 * arena — a monochrome grid, a white triangle ship and its pod, low-poly
 * machines drawn as filled wireframes, orange and purple orbs. The camera
 * holds a view for tens of seconds, then eases to the next: in 3D, from
 * above, from the side, where the field stands up as a wall over the floor.
 *
 * Every colour is a token, mixed toward the page's own background, so the
 * scene sits behind a title at low contrast; tone mapping is off, so the
 * ground is the page's colour exactly and the frame has no seam. Under
 * reduced motion the stage steps every frame by 0: the camera stands at the
 * still view over a play already under way.
 *
 * Only `arena-backdrop.tsx` imports this, by a dynamic import of its own:
 * three loads only when a page head shows the Arena.
 */
import {
  BoxGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DynamicDrawUsage,
  EdgesGeometry,
  Float32BufferAttribute,
  Group,
  IcosahedronGeometry,
  InstancedBufferAttribute,
  LineBasicNodeMaterial,
  LineSegments,
  Mesh,
  MeshBasicNodeMaterial,
  Plane,
  Raycaster,
  RingGeometry,
  Vector2,
  Vector3,
  BufferGeometry,
  type Node,
  type Object3D,
  type PerspectiveCamera,
  type UniformNode,
} from "three/webgpu";
import {
  float,
  instancedBufferAttribute,
  mix,
  normalView,
  positionLocal,
  step,
  uniform,
} from "three/tsl";
import { colorUniform, mountScene, type PaletteUniforms, type SceneStage } from "@kb/scene-gpu";
import type { SceneHandle, ScenePalette } from "@kb/scene";
import type { PointerPlace, PointerSource, Timing } from "@kb/ui-sdk";
import {
  ArenaPlay,
  CAPACITY,
  FIELD,
  STILL_VIEW,
  viewAt,
  type ArenaView,
  type FieldPoint,
} from "./arena-sim";

/** The colours the stage's palette has no role for, each a token's. */
export interface ArenaColors {
  /** The purple orbs'. */
  readonly purple: string;
  /** The ship's fill, and how much of it shows over the ground (0–1). */
  readonly ship: string;
  readonly shipShare: number;
  /** The head's colour, which the pod's lines wear. */
  readonly head: string;
}

/** How the page looks: the stage's palette, and the colours it has no role for. */
export interface ArenaLook {
  readonly palette: ScenePalette;
  readonly dark: boolean;
  readonly colors: ArenaColors;
}

export interface ArenaInit extends ArenaLook {
  readonly timing: Timing;
  readonly reducedMotion: boolean;
  readonly pointer: PointerSource;
  /** The play's seed; the same seed always plays the same. */
  readonly seed: number;
}

/**
 * What the owner is doing, as one frame reads it: `calm` eases to 1 while a
 * node's text is being edited and back to 0 after, and `pointer` is where the
 * pointer is over the frame (CSS pixels), if it is. The same signals as the
 * shared GPU host's `Reactions`, so the Arena reads them the same way.
 */
export interface ArenaReactions {
  readonly calm: number;
  readonly pointer: PointerPlace | null;
}

/** The frame as the Arena lays itself out in it (`quality` 1 at full detail). */
export interface ArenaLayout {
  readonly width: number;
  readonly height: number;
  readonly quality: number;
}

/** A mounted Arena, as its React host drives it. */
export interface ArenaScene extends SceneHandle {
  setLook(look: ArenaLook): void;
  /** A write landed: a nudge to the play, never a restart. */
  write(): void;
  setEditing(editing: boolean): void;
  setPointer(pointer: PointerSource): void;
}

/** How much of each colour shows over the ground: low, so a title reads over all of it. */
const SHARE = {
  grid: 0.06,
  floor: 0.05,
  frame: 0.13,
  line: 0.22,
  fill: 0.03,
  orange: 0.42,
  purple: 0.36,
  pellet: 0.28,
  reticle: 0.3,
} as const;
/** How high things stand off the field, in field units. */
const HOVER = { ship: 0.14, pod: 0.62, orb: 0.24, reticle: 0.02 } as const;
/** How many seconds of play a scene arrives into. */
const PREROLL = 14;

type Vec3Node = Node<"vec3">;

/** sRGB's transfer, near enough for mixing: the stage's colours are linear light. */
const GAMMA = 2.2;

/**
 * `share` of the way from `from` to `to`, mixed as the eye sees it (in
 * sRGB, not linear light), so the same share reads as the same contrast on
 * the beige page and on the dark one.
 */
function toward(from: Vec3Node, to: Vec3Node, share: number | Node<"float">): Vec3Node {
  return mix(from.pow(1 / GAMMA), to.pow(1 / GAMMA), share).pow(GAMMA);
}
type ColorNode = UniformNode<"vec3", Color>;

/** Where field point (u, v) stands `up` off the field, with the field stood up by `hinge`. */
function place(u: number, v: number, up: number, hinge: number, out: Vector3): Vector3 {
  const s = Math.sin(hinge);
  const c = Math.cos(hinge);
  return out.set(u, FIELD.lift * s - v * s + up * c, v * c + up * s);
}

/** The stage parts the Arena builds on. */
type ArenaStage = Pick<SceneStage, "scene" | "camera" | "colors" | "atmosphere">;

interface Materials {
  readonly fill: MeshBasicNodeMaterial;
  readonly line: LineBasicNodeMaterial;
}

/** A low-poly model: its faces filled near the ground (they hide the grid behind), its edges drawn. */
function wire(geometry: BufferGeometry, materials: Materials): Group {
  const model = new Group();
  model.add(new Mesh(geometry, materials.fill));
  model.add(new LineSegments(new EdgesGeometry(geometry, 1), materials.line));
  return model;
}

function fillMaterial(color: Vec3Node): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial();
  material.colorNode = color;
  // The edges are drawn at the faces' own depth; the faces give way to them.
  material.polygonOffset = true;
  material.polygonOffsetFactor = 1;
  material.polygonOffsetUnits = 1;
  return material;
}

function lineMaterial(color: Vec3Node): LineBasicNodeMaterial {
  const material = new LineBasicNodeMaterial();
  material.colorNode = color;
  return material;
}

/** Line segments from a flat list of point pairs. */
function segments(points: readonly number[], material: LineBasicNodeMaterial): LineSegments {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(points, 3));
  return new LineSegments(geometry, material);
}

/** The field's own grid, its frame, and YoRHa's brackets at its corners, in the field's plane (y = 0). */
function fieldLines(colors: PaletteUniforms): Group {
  const grid: number[] = [];
  const { halfWidth: w, halfDepth: d } = FIELD;
  for (let u = -w; u <= w + 1e-6; u += w / 10) grid.push(u, 0, -d, u, 0, d);
  for (let v = -d; v <= d + 1e-6; v += d / 2) grid.push(-w, 0, v, w, 0, v);
  const frame: number[] = [];
  const o = 0.35;
  const b = 0.9;
  for (const [x, z, sx, sz] of [
    [-w - o, -d - o, 1, 1],
    [w + o, -d - o, -1, 1],
    [-w - o, d + o, 1, -1],
    [w + o, d + o, -1, -1],
  ] as const) {
    frame.push(x, 0, z, x + sx * b, 0, z, x, 0, z, x, 0, z + sz * b);
  }
  const lines = new Group();
  lines.add(segments(grid, lineMaterial(toward(colors.ground, colors.ink, SHARE.grid))));
  lines.add(segments(frame, lineMaterial(toward(colors.ground, colors.ink, SHARE.frame))));
  return lines;
}

/** The floor under a field stood up as a wall: wide, and shown only as far as the field stands. */
function floorLines(colors: PaletteUniforms, shown: UniformNode<"float", number>): LineSegments {
  const points: number[] = [];
  const pitch = 1.5;
  for (let x = -42; x <= 42; x += pitch) points.push(x, -0.02, -30, x, -0.02, 12);
  for (let z = -30; z <= 12; z += pitch) points.push(-42, -0.02, z, 42, -0.02, z);
  return segments(
    points,
    lineMaterial(toward(colors.ground, colors.ink, float(SHARE.floor).mul(shown))),
  );
}

/** The ship: a flat triangle, its point along +z (`lookAt` turns it). */
function shipModel(colors: PaletteUniforms, ship: ColorNode, share: UniformNode<"float", number>) {
  const hull = new ConeGeometry(0.34, 0.95, 3);
  hull.rotateX(Math.PI / 2);
  hull.scale(1, 0.4, 1);
  return wire(hull, {
    fill: fillMaterial(toward(colors.ground, ship, share)),
    line: lineMaterial(toward(colors.ground, colors.ink, SHARE.line + 0.08)),
  });
}

/** The pod: an upright box with two arms hanging under it, its lines in the head's colour. */
function podModel(colors: PaletteUniforms, head: ColorNode): Group {
  const materials = {
    fill: fillMaterial(toward(colors.ground, colors.ink, SHARE.fill)),
    line: lineMaterial(toward(colors.ground, head, SHARE.line + 0.06)),
  };
  const pod = new Group();
  pod.add(wire(new BoxGeometry(0.34, 0.44, 0.3), materials));
  for (const side of [-1, 1]) {
    const arm = wire(new BoxGeometry(0.07, 0.3, 0.07), materials);
    arm.position.set(side * 0.11, -0.36, 0);
    pod.add(arm);
  }
  return pod;
}

/** A machine: a round low-poly head on a stubby six-sided body, two arms, two orange eyes. */
function machineModel(colors: PaletteUniforms): Group {
  const materials = {
    fill: fillMaterial(toward(colors.ground, colors.ink, SHARE.fill)),
    line: lineMaterial(toward(colors.ground, colors.ink, SHARE.line)),
  };
  const machine = new Group();
  const head = wire(new IcosahedronGeometry(0.3, 0), materials);
  head.position.y = 0.74;
  const body = wire(new CylinderGeometry(0.24, 0.3, 0.5, 6), materials);
  body.position.y = 0.3;
  machine.add(head, body);
  for (const side of [-1, 1]) {
    const arm = wire(new CylinderGeometry(0.045, 0.045, 0.42, 4), materials);
    arm.position.set(side * 0.36, 0.34, 0);
    arm.rotation.z = side * 0.4;
    machine.add(arm);
  }
  const eyes = fillMaterial(toward(colors.ground, colors.hue, SHARE.orange));
  for (const side of [-1, 1]) {
    const eye = new Mesh(new BoxGeometry(0.07, 0.07, 0.04), eyes);
    eye.position.set(side * 0.1, 0.76, 0.27);
    machine.add(eye);
  }
  return machine;
}

/** Where the pointer is aiming: a thin ring with four ticks, lying in the field's plane. */
function reticleModel(colors: PaletteUniforms): Group {
  const material = lineMaterial(toward(colors.ground, colors.ink, SHARE.reticle));
  const reticle = new Group();
  const ring = new RingGeometry(0.4, 0.43, 40);
  ring.rotateX(-Math.PI / 2);
  const ringFill = new MeshBasicNodeMaterial();
  ringFill.colorNode = toward(colors.ground, colors.ink, SHARE.reticle);
  reticle.add(new Mesh(ring, ringFill));
  const ticks: number[] = [];
  for (const [x, z] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const) {
    ticks.push(x * 0.5, 0, z * 0.5, x * 0.72, 0, z * 0.72);
  }
  reticle.add(segments(ticks, material));
  return reticle;
}

/** The orbs and pellets: one instanced low-poly sphere, each instance placed, sized and coloured. */
function orbs(colors: PaletteUniforms, purple: ColorNode) {
  const state = new InstancedBufferAttribute(new Float32Array(CAPACITY * 4), 4);
  state.setUsage(DynamicDrawUsage);
  const kinds = new InstancedBufferAttribute(new Float32Array(CAPACITY), 1);
  kinds.setUsage(DynamicDrawUsage);
  const s = instancedBufferAttribute<"vec4">(state);
  const k = instancedBufferAttribute<"float">(kinds);
  const material = new MeshBasicNodeMaterial();
  material.positionNode = positionLocal.mul(s.w).add(s.xyz);
  const orange = toward(colors.ground, colors.hue, SHARE.orange);
  const violet = toward(colors.ground, purple, SHARE.purple);
  const pellet = toward(colors.ground, colors.ink, SHARE.pellet);
  const base = mix(mix(orange, violet, step(0.5, k)), pellet, step(1.5, k));
  // Each orb's rim falls toward the ground: an orb, not a disc.
  const rim = float(1).sub(normalView.z.abs());
  material.colorNode = toward(base, colors.ground, rim.mul(0.6));
  const mesh = new Mesh(new IcosahedronGeometry(1, 1), material);
  mesh.count = CAPACITY;
  mesh.frustumCulled = false;
  return { mesh, state, kinds };
}

/** Everything the Arena draws, in the stage's scene, and the uniforms it turns. */
function arenaModels(on: ArenaStage, init: ArenaInit) {
  const { scene, colors } = on;
  scene.backgroundNode = colors.ground;
  const tints = {
    purple: colorUniform(new Color(init.colors.purple)),
    ship: colorUniform(new Color(init.colors.ship)),
    head: colorUniform(new Color(init.colors.head)),
    shipShare: uniform(init.colors.shipShare),
    floorShown: uniform(0),
  };
  const field = new Group();
  field.add(fieldLines(colors));
  const reticle = reticleModel(colors);
  reticle.visible = false;
  field.add(reticle);
  const models = {
    field,
    reticle,
    floor: floorLines(colors, tints.floorShown),
    ship: shipModel(colors, tints.ship, tints.shipShare),
    pod: podModel(colors, tints.head),
    machines: Array.from({ length: 3 }, () => machineModel(colors)),
    bullets: orbs(colors, tints.purple),
  };
  scene.add(field, models.floor, models.ship, models.pod, ...models.machines, models.bullets.mesh);
  return { ...models, tints, range: on.atmosphere(10, 30) };
}
type ArenaModels = ReturnType<typeof arenaModels>;

/** Stand the camera at `view`, near enough that the field fills the frame (its ends feathered off), far enough for most of its depth. */
function stand(models: ArenaModels, eye: PerspectiveCamera, view: ArenaView, target: Vector3) {
  const tan = Math.tan(((view.fov / 2) * Math.PI) / 180);
  const distance = Math.max(
    (FIELD.halfWidth * 0.86) / (tan * Math.max(eye.aspect, 0.1)),
    (FIELD.halfDepth * (0.9 + 0.35 * Math.cos(view.pitch) * Math.cos(view.hinge))) / tan,
  );
  // Seen at a slant the far edge rises out of the frame, so the camera looks a
  // little past the middle toward it: by as much as the view is oblique and
  // the field lies flat (none from straight above, none at a wall).
  const lean = FIELD.halfDepth * 0.55 * Math.cos(view.pitch) * Math.cos(view.hinge);
  target.set(0, FIELD.lift * Math.sin(view.hinge), -lean);
  eye.fov = view.fov;
  eye.position.set(
    target.x + distance * Math.cos(view.pitch) * Math.sin(view.yaw),
    target.y + distance * Math.sin(view.pitch),
    target.z + distance * Math.cos(view.pitch) * Math.cos(view.yaw),
  );
  eye.lookAt(target);
  eye.updateProjectionMatrix();
  models.range.near.value = distance * 0.85;
  models.range.far.value = distance * 2.6;
}

/** Lay the play out on the field as `hinge` stands it; `drawn` is how many orbs were drawn last. */
function lay(models: ArenaModels, play: ArenaPlay, hinge: number, drawn: number, at: Vector3) {
  models.field.rotation.x = hinge;
  models.field.position.y = FIELD.lift * Math.sin(hinge);
  models.tints.floorShown.value = Math.sin(hinge);
  models.floor.visible = models.tints.floorShown.value > 0.01;
  const { ship, pod } = play;
  place(ship.u, ship.v, HOVER.ship, hinge, models.ship.position);
  // The ship points along its heading, banking a little as it drifts across.
  const heading = Math.max(-0.5, Math.min(0.5, ship.dv * 0.6));
  models.ship.lookAt(
    place(ship.u + Math.cos(heading), ship.v + Math.sin(heading), HOVER.ship, hinge, at),
  );
  place(pod.u, pod.v, HOVER.pod, hinge, models.pod.position);
  models.pod.rotation.y = 0.3 * Math.sin(play.time * 0.4);
  play.machines.forEach((machine, i) => {
    const model: Object3D | undefined = models.machines[i];
    if (model === undefined) return;
    place(machine.u, machine.v, 0, hinge, model.position);
    model.rotation.y = 0.4 * Math.sin(play.time * 0.2 + machine.phase) - 0.3;
  });
  const { state, kinds } = models.bullets;
  for (let i = 0; i < play.count; i++) {
    place(play.u[i] ?? 0, play.v[i] ?? 0, HOVER.orb, hinge, at);
    state.array[i * 4] = at.x;
    state.array[i * 4 + 1] = at.y;
    state.array[i * 4 + 2] = at.z;
    state.array[i * 4 + 3] = play.radius(i);
    kinds.array[i] = play.kind[i] ?? 0;
  }
  // The slots emptied since the last frame draw nothing.
  for (let i = play.count; i < drawn; i++) state.array[i * 4 + 3] = 0;
  state.needsUpdate = true;
  kinds.needsUpdate = true;
}

/** The pointer over the frame, met with the field through the camera. */
class FieldAim {
  width = 0;
  height = 0;
  private readonly ndc = new Vector2();
  private readonly ray = new Raycaster();
  private readonly plane = new Plane();
  private readonly normal = new Vector3();
  private readonly origin = new Vector3();
  private readonly hit = new Vector3();

  /** Where `over` meets the field stood up by `hinge`, if it is near the field. */
  at(camera: PerspectiveCamera, over: PointerPlace | null, hinge: number): FieldPoint | null {
    if (over === null || this.width <= 0 || this.height <= 0) return null;
    const s = Math.sin(hinge);
    const c = Math.cos(hinge);
    this.ndc.set((over.x / this.width) * 2 - 1, 1 - (over.y / this.height) * 2);
    this.ray.setFromCamera(this.ndc, camera);
    this.origin.set(0, FIELD.lift * s, 0);
    this.plane.setFromNormalAndCoplanarPoint(this.normal.set(0, c, s), this.origin);
    if (this.ray.ray.intersectPlane(this.plane, this.hit) === null) return null;
    this.hit.sub(this.origin);
    const u = this.hit.x;
    const v = c * this.hit.z - s * this.hit.y;
    const near = Math.abs(u) < FIELD.halfWidth + 1 && Math.abs(v) < FIELD.halfDepth + 1;
    return near ? { u, v } : null;
  }
}

/** How hard a write nudges the play, and a keystroke's (a write while typing). */
const WRITE_NUDGE = 0.7;
const TYPING_NUDGE = 0.035;

/**
 * Build the Arena on `on`: every object it draws goes into the stage's
 * scene, so the stage's own disposal frees every GPU resource it took. Its
 * verbs are the shared GPU host's (`BackdropParts`): a frame read with the
 * owner's reactions, a layout, a look, a write and a disposal. The play and
 * its clock are made here once and live as long as the scene.
 */
export function buildArena(on: ArenaStage, init: ArenaInit) {
  const models = arenaModels(on, init);
  const play = new ArenaPlay(init.seed);
  play.advance(PREROLL);
  const aim = new FieldAim();
  const at = new Vector3();
  let clock = 0;
  let calm = 0;
  let view = STILL_VIEW;
  stand(models, on.camera, view, at);
  lay(models, play, view.hinge, 0, at);

  return {
    /** One frame: `dt` is 0 under reduced motion, which leaves the still view standing. */
    frame: (dt: number, reactions: ArenaReactions) => {
      clock += dt;
      calm = reactions.calm;
      const over = aim.at(on.camera, reactions.pointer, view.hinge);
      models.reticle.visible = over !== null;
      if (over !== null) models.reticle.position.set(over.u, HOVER.reticle, over.v);
      const drawn = play.count;
      play.step(dt, over);
      view = dt > 0 ? viewAt(clock) : view;
      stand(models, on.camera, view, at);
      lay(models, play, view.hinge, drawn, at);
    },
    /** Seconds the scene has played: it only ever grows. */
    clock: () => clock,
    layout: ({ width, height }: ArenaLayout) => {
      aim.width = width;
      aim.height = height;
      stand(models, on.camera, view, at);
    },
    setLook: ({ colors }: ArenaLook) => {
      models.tints.purple.value.set(colors.purple);
      models.tints.ship.value.set(colors.ship);
      models.tints.head.value.set(colors.head);
      models.tints.shipShare.value = colors.shipShare;
    },
    /** A write landed: typing nudges the pod a little, a write made otherwise more. */
    write: () => play.nudge(TYPING_NUDGE + (WRITE_NUDGE - TYPING_NUDGE) * (1 - calm)),
    /** Everything it holds is in the stage's scene, which the stage frees. */
    dispose: () => undefined,
  };
}

/** How fast `calm` follows typing in and out (per second). */
const CALM_IN = 1.4;
const CALM_OUT = 0.55;

/**
 * Mount the Arena into `host`, as its own small host until it moves onto the
 * shared one: the reactions (typing eased into `calm`, the pointer polled),
 * a frame only while the tab is visible and the frame is on screen.
 */
export async function mountArena(host: HTMLElement, init: ArenaInit): Promise<ArenaScene> {
  let pointer = init.pointer;
  let editing = false;
  let calm = 0;
  const { stage, parts, handle } = await mountScene(
    host,
    {
      fov: STILL_VIEW.fov,
      near: 0.1,
      far: 200,
      palette: init.palette,
      timing: init.timing,
      reducedMotion: init.reducedMotion,
      bloom: { strength: 0, radius: 0 },
      vignette: 0.3,
    },
    (on) => {
      on.setToneMapping("none");
      const arena = buildArena(on, init);
      return {
        ...arena,
        frame: (dt: number) => {
          const rate = editing ? CALM_IN : CALM_OUT;
          calm += ((editing ? 1 : 0) - calm) * (1 - Math.exp(-rate * dt));
          arena.frame(dt, { calm, pointer: pointer.now() });
          return true;
        },
        resize: (width: number, height: number) => arena.layout({ width, height, quality: 1 }),
      };
    },
  );
  let tab = true;
  let onScreen = true;
  const watch =
    typeof IntersectionObserver === "undefined"
      ? null
      : new IntersectionObserver(([entry]) => {
          onScreen = entry?.isIntersecting ?? true;
          handle.setRunning(tab && onScreen);
        });
  watch?.observe(host);
  return {
    ...handle,
    setRunning: (running) => {
      tab = running;
      handle.setRunning(tab && onScreen);
    },
    dispose: () => {
      watch?.disconnect();
      handle.dispose();
    },
    setLook: (look) => {
      stage.setPalette(look.palette);
      parts.setLook(look);
      stage.invalidate();
    },
    write: () => {
      parts.write();
      stage.invalidate();
    },
    setEditing: (next) => {
      editing = next;
    },
    setPointer: (next) => {
      pointer = next;
    },
  };
}
