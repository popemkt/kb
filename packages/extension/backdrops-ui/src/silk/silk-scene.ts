/**
 * The Silk backdrop: silk ribbons in three depths on a stage that opens onto
 * a faint cosmos (shaders: `silk-shader.ts`). Their dyes, depths and paths
 * are art-directed; each load varies them a little (`variation`): where each
 * ribbon crosses, a few degrees of the dyes' hue, and where in its cycle each
 * one starts.
 *
 * Layers: BG ribbons soft in the haze, the in-focus MG hero, and two large
 * defocused FG edges framing the right-hand corners, each at its own
 * parallax rate; now and then the focus breathes, drifting a little toward
 * the BG and back.
 *
 * The owner: the pointer is a breath of wind that lifts and flips the
 * ribbons and stirs the dust, and the layers slide with it; typing slows
 * everything and rests the light sweep; the owner's activity
 * (`reactions.impulse`) brightens a shimmer that runs along every ribbon
 * without end (the film thickens as it passes), and a stir lifts their
 * flutter. Nothing is ever restarted: the clocks only run forward.
 */
import { DataTexture, DataUtils, HalfFloatType, LinearFilter, RGFormat } from "three/webgpu";
import { offscreenPass, type SceneStage } from "@kb/scene-gpu";
import type { Reactions } from "../scene/reactions";
import { turnHue, variation } from "../scene/seed";
import { PANEL_WIDTH, WIDE_WIDTH } from "../gpu/framing";
import {
  mountBackdrop,
  type BackdropLayout,
  type BackdropParts,
  type GpuBackdropInit,
  type GpuBackdropScene,
  type GpuLook,
  groundsOf,
} from "../gpu/gpu-scene";
import {
  PUFFS,
  RIBBONS,
  WAKE_SAMPLES,
  cosmosFragment,
  silkFragment,
  silkFrame,
  silkUniforms,
  type SilkUniforms,
} from "./silk-shader";
import { COSMOS_MARGIN } from "./silk-stage";

type Rgb = readonly [number, number, number];

interface Ribbon {
  readonly y0: number;
  readonly tilt: number;
  readonly a1: number;
  readonly f1: number;
  readonly a2: number;
  readonly f2: number;
  readonly width: number;
  readonly twist: number;
  /** 1 far (BG), 0 the hero (MG), -1 at the lens (FG). */
  readonly depth: number;
  readonly sheer: number;
  readonly speed: number;
  /** Defocus, in pixels of a 720-pixel frame. */
  readonly coc: number;
  /** Each face's dye, linear, on a dark page and a light one. */
  readonly front: readonly [Rgb, Rgb];
  readonly back: readonly [Rgb, Rgb];
}

/** Far to near, the order they are laid. */
const RIBBON_SET: readonly Ribbon[] = [
  // BG: thin, soft, dim, sunk in the haze; they set depth, never the subject.
  {
    y0: 0.37,
    tilt: 0,
    a1: 0.06,
    f1: 1.1,
    a2: 0.025,
    f2: 2.7,
    width: 0.026,
    twist: 1.4,
    depth: 1,
    sheer: 0.3,
    speed: 0.8,
    coc: 8,
    front: [
      [0.09, 0.05, 0.22],
      [0.5, 0.66, 0.7],
    ],
    back: [
      [0.2, 0.05, 0.16],
      [0.74, 0.58, 0.7],
    ],
  },
  {
    y0: 0.14,
    tilt: 0,
    a1: 0.05,
    f1: 1.4,
    a2: 0.02,
    f2: 3.1,
    width: 0.02,
    twist: 1.8,
    depth: 1,
    sheer: 0.3,
    speed: 0.9,
    coc: 9,
    front: [
      [0.22, 0.06, 0.12],
      [0.88, 0.66, 0.55],
    ],
    back: [
      [0.06, 0.08, 0.2],
      [0.6, 0.68, 0.88],
    ],
  },
  {
    y0: 0.46,
    tilt: 0,
    a1: 0.04,
    f1: 0.9,
    a2: 0.02,
    f2: 2.2,
    width: 0.018,
    twist: 1.1,
    depth: 0.85,
    sheer: 0.3,
    speed: 1.1,
    coc: 7,
    front: [
      [0.1, 0.12, 0.2],
      [0.66, 0.74, 0.64],
    ],
    back: [
      [0.24, 0.1, 0.06],
      [0.88, 0.72, 0.6],
    ],
  },
  // MG, the hero, in focus: a sheer champagne organza behind a double-faced satin.
  {
    y0: 0.27,
    tilt: 0,
    a1: 0.11,
    f1: 1.25,
    a2: 0.04,
    f2: 3.4,
    width: 0.062,
    twist: 1.5,
    depth: 0.25,
    sheer: 0.85,
    speed: 1,
    coc: 0,
    front: [
      [0.62, 0.4, 0.2],
      [0.5, 0.4, 0.88],
    ],
    back: [
      [0.55, 0.32, 0.16],
      [0.62, 0.42, 0.86],
    ],
  },
  {
    y0: 0.24,
    tilt: 0,
    a1: 0.13,
    f1: 1.55,
    a2: 0.045,
    f2: 3.7,
    width: 0.078,
    twist: 1.9,
    depth: 0,
    sheer: 0.05,
    speed: 1,
    coc: 0,
    front: [
      [0.018, 0.03, 0.1],
      [0.5, 0.56, 0.74],
    ],
    back: [
      [0.3, 0.19, 0.08],
      [0.84, 0.5, 0.52],
    ],
  },
  // FG: two big, heavily defocused edges at the lens, sloped into the right-hand corners.
  {
    y0: 0.5,
    tilt: -0.24,
    a1: 0.03,
    f1: 0.8,
    a2: 0.02,
    f2: 1.7,
    width: 0.1,
    twist: 0.9,
    depth: -1,
    sheer: 0.4,
    speed: 0.7,
    coc: 26,
    front: [
      [0.22, 0.03, 0.1],
      [0.9, 0.62, 0.64],
    ],
    back: [
      [0.08, 0.04, 0.2],
      [0.7, 0.64, 0.92],
    ],
  },
  {
    y0: -0.42,
    tilt: 0.2,
    a1: 0.03,
    f1: 0.7,
    a2: 0.02,
    f2: 1.5,
    width: 0.12,
    twist: 0.8,
    depth: -0.85,
    sheer: 0.3,
    speed: 0.6,
    coc: 30,
    front: [
      [0.03, 0.09, 0.14],
      [0.6, 0.78, 0.84],
    ],
    back: [
      [0.24, 0.12, 0.05],
      [0.92, 0.74, 0.6],
    ],
  },
];

/** The light sweep crosses the frame this often (s). */
const SWEEP_PERIOD = 13;
/** The pointer's wind: a new puff each time it has moved this far (frame heights). */
const PUFF_STEP = 0.05;
/** How long a puff pushes (s). */
const PUFF_LIFE = 4;
/** How far the ribbons rise in a side panel (frame heights). */
const PANEL_LIFT = 0.09;
/** The cosmos is redrawn this often (s): it changes over minutes. */
const COSMOS_EVERY = 0.15;
/** How fast the shimmer runs along the ribbons (frame heights a second). */
const SHIMMER_SPEED = 1.1;

interface Puff {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
}

/** Ribbon `r`'s centre at `x` (frame units, before the lift), as the shader draws it before the wind. */
function centreAt(r: Ribbon, phase: number, twist: number, x: number): number {
  const tt = twist * r.speed;
  return (
    r.y0 +
    r.tilt * x +
    r.a1 * Math.sin(x * r.f1 + tt * 0.13 + phase) +
    r.a2 * Math.sin(x * r.f2 - tt * 0.21 + phase * 2)
  );
}

/** The puffs' push (dy, dx) on ribbon `r` at `x`, where its centre is `c`. */
function push(puffs: readonly Puff[], r: Ribbon, x: number, c: number): readonly [number, number] {
  const k = 1.15 - r.depth * 0.45;
  let dx = 0;
  let dy = 0;
  for (const p of puffs) {
    const e = 1 - Math.exp(-p.age * 1.5);
    const rx = x - (p.x + p.vx * 0.35 * e);
    const ry = c - (p.y + p.vy * 0.35 * e);
    const sg = 0.07 + p.age * 0.07;
    const f =
      Math.exp(-(rx * rx + ry * ry) / (sg * sg)) *
      Math.exp(-p.age * 1.1) *
      (1 - Math.exp(-p.age * 8)) *
      k;
    dx += p.vx * f;
    dy += p.vy * f;
  }
  return [dy, dx];
}

/**
 * The pointer's wind as a strip: its push along each ribbon depends only on
 * x along it, so it is summed here once a frame and the shader reads one
 * texel a ribbon instead of every puff at every pixel.
 */
function windStrip(phases: readonly number[]) {
  const strip = new Uint16Array(WAKE_SAMPLES * RIBBONS * 2);
  const texture = new DataTexture(strip, WAKE_SAMPLES, RIBBONS, RGFormat, HalfFloatType);
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.needsUpdate = true;
  let live = false;
  return {
    texture,
    update: (puffs: readonly Puff[], twist: number, lift: number) => {
      if (puffs.length === 0 && !live) return;
      live = puffs.length > 0;
      strip.fill(0);
      if (live)
        RIBBON_SET.forEach((r, i) => {
          const phase = phases[i] ?? 0;
          for (let j = 0; j < WAKE_SAMPLES; j++) {
            const x = (j / (WAKE_SAMPLES - 1)) * 4.8 - 2.4;
            const [dy, dx] = push(puffs, r, x, lift + centreAt(r, phase, twist, x));
            strip[(i * WAKE_SAMPLES + j) * 2] = DataUtils.toHalfFloat(dy);
            strip[(i * WAKE_SAMPLES + j) * 2 + 1] = DataUtils.toHalfFloat(dx);
          }
        });
      texture.needsUpdate = true;
    },
  };
}

/**
 * The pointer as the layers' parallax and as wind: eased toward it while it
 * is near (a slow idle drift otherwise), and a puff each time it has moved
 * far enough, carrying its clamped velocity. Returns the live puffs.
 */
function pointerWind(u: SilkUniforms) {
  const puffs: Puff[] = Array.from({ length: PUFFS }, () => ({
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    age: 99,
  }));
  let next = 0;
  let last: { x: number; y: number } | null = null;
  const blow = (x: number, y: number, dt: number, near: number) => {
    if (last === null || dt <= 0) return;
    const vx = (x - last.x) / dt;
    const vy = (y - last.y) / dt;
    const speed = Math.hypot(vx, vy);
    const previous = puffs[(next + PUFFS - 1) % PUFFS];
    if (
      speed <= 0.05 ||
      previous === undefined ||
      Math.hypot(x - previous.x, y - previous.y) <= PUFF_STEP
    )
      return;
    // A breath of air, not a gust.
    const c = Math.min(1, 0.9 / speed) * 0.04 * near;
    puffs[next] = { x, y, vx: vx * c, vy: vy * c, age: 0 };
    next = (next + 1) % PUFFS;
  };
  return (
    pointer: Reactions["pointer"],
    frame: { width: number; height: number },
    dt: number,
    time: number,
  ) => {
    const ease = 1 - Math.exp(-dt * 3);
    const par = u.parallax.value;
    if (pointer.near > 0.05) {
      const x = (pointer.x - frame.width / 2) / frame.height;
      const y = (frame.height / 2 - pointer.y) / frame.height;
      par.set(par.x + (x - par.x) * ease, par.y + (y - par.y) * ease);
      blow(x, y, dt, pointer.near);
      last = { x, y };
    } else {
      last = null;
      const x = 0.18 * Math.sin(time * 0.045);
      const y = 0.08 * Math.sin(time * 0.031 + 1);
      par.set(par.x + (x - par.x) * ease * 0.3, par.y + (y - par.y) * ease * 0.3);
    }
    const live = puffs.filter((p) => {
      p.age += dt;
      return p.age < PUFF_LIFE;
    });
    u.puffs.forEach((puff, k) => {
      const p = live[k];
      if (p !== undefined) puff.value.set(p.x, p.y, p.vx, p.vy);
      const age = u.puffAges[k];
      if (age !== undefined) age.value = p?.age ?? 99;
    });
    u.puffCount.value = live.length;
    return live;
  };
}

function silk(stage: SceneStage, init: GpuBackdropInit): BackdropParts {
  const vary = variation(init.seed);
  const u = silkUniforms();
  const phases = RIBBON_SET.map((_, i) => vary.phase(`ribbon.${i}`));
  /** A few degrees either way: the dyes stay the art's. */
  const hue = vary.range("hue", -0.1, 0.1);
  RIBBON_SET.forEach((r, i) => {
    u.ribbon.geo1[i]?.set(r.y0 + vary.range(`ribbon.${i}.y`, -0.015, 0.015), r.a1, r.f1, r.a2);
    u.ribbon.geo2[i]?.set(r.f2, phases[i] ?? 0, r.width, r.twist);
    u.ribbon.geo3[i]?.set(r.depth, r.sheer, r.speed, r.coc);
    u.ribbon.geo4[i]?.set(r.tilt, 0, 0, 0);
  });
  // A still is one curated moment; a live mount starts somewhere in the ribbons' cycle.
  let time = init.reducedMotion ? 52 : vary.range("clock", 40, 60);
  let twist = time;
  let sweepClock = init.reducedMotion ? 5.5 : 3;
  let shimmer = vary.range("shimmer", 0, 4.8);
  const wind = windStrip(phases);
  const blow = pointerWind(u);
  const grounds = groundsOf(stage);
  const depths = { depth: RIBBON_SET.map((r) => r.depth), sheer: RIBBON_SET.map((r) => r.sheer) };
  const cosmos = offscreenPass(stage.renderer, () => cosmosFragment(u), { history: false });
  const picture = offscreenPass(
    stage.renderer,
    (inputs) =>
      silkFragment(u, { wake: wind.texture, cosmos: cosmos.picture }, depths, grounds, inputs),
    { history: false },
  );
  let sinceCosmos = Infinity;
  stage.scene.backgroundNode = silkFrame(u, picture.picture, grounds);
  const frameSize = { width: 1, height: 1 };
  const applyLook = (look: GpuLook) => {
    u.dark.value = look.dark ? 1 : 0;
    const face = look.dark ? 0 : 1;
    RIBBON_SET.forEach((r, i) => {
      u.ribbon.front[i]?.set(...turnHue(r.front[face], hue), 0);
      u.ribbon.back[i]?.set(...turnHue(r.back[face], hue), 0);
    });
  };
  applyLook(init);

  return {
    // The hero crosses the frame high, over and right of the title; a panel keeps it, quieter.
    panel: { x: 0.12, y: 0.2, scale: 1, presence: 1 },
    wide: { x: 0.2, y: 0.2, scale: 1, presence: 1 },
    layout: (layout: BackdropLayout) => {
      const { width, height, quality } = layout;
      frameSize.width = width;
      frameSize.height = height;
      u.aspect.value = width / height;
      u.scrim.layout(layout);
      // In a narrow frame the text crosses it: the ribbons rise to keep above the title.
      u.lift.value =
        PANEL_LIFT *
        (1 - Math.min(1, Math.max(0, (width - PANEL_WIDTH) / (WIDE_WIDTH - PANEL_WIDTH))));
      // About one texel a device pixel at full quality (the stage's ratio, at most 2), fewer as it falls.
      const share = Math.min(window.devicePixelRatio || 1, 2) * (0.5 + 0.35 * quality);
      picture.setSize(width * share, height * share);
      // The cosmos is soft and slow: a texel about every three CSS pixels, a little past the frame.
      const reach = width / height / 2 + COSMOS_MARGIN;
      u.cosmosWindow.value.set(-reach, -0.5 - COSMOS_MARGIN, reach, 0.5 + COSMOS_MARGIN);
      const texel = 0.25 + 0.1 * quality;
      cosmos.setSize(
        (width + 2 * COSMOS_MARGIN * height) * texel,
        (height + 2 * COSMOS_MARGIN * height) * texel,
      );
      sinceCosmos = Infinity;
      // The silk is a field: its ribbons cross the whole frame, with no one hero.
      return null;
    },
    setLook: (look: GpuLook) => {
      applyLook(look);
      stage.setBloom(look.dark ? 0.2 : 0.05);
    },
    frame: (dt: number, reactions: Reactions) => {
      // The clocks only run forward; typing slows them and rests the sweep; a stir lifts the flutter.
      const pace = 1 - reactions.calm * 0.6;
      time += dt * pace;
      twist += dt * pace * (1 + 0.5 * reactions.stir);
      sweepClock += dt * (1 - reactions.calm * 0.9);
      shimmer += dt * SHIMMER_SPEED;
      u.time.value = time;
      u.twist.value = twist;
      u.calm.value = reactions.calm;
      // The shimmer never starts over: it always runs, as bright as the owner's activity.
      u.shimmer.value.set(shimmer, Math.min(1.2, reactions.impulse));
      // Focus breathes now and then: mostly still, sometimes drifting toward the BG and back.
      const focus =
        0.3 * Math.pow(0.5 + 0.5 * Math.sin(time * 0.21 + 1.3), 4) * (1 - reactions.calm);
      RIBBON_SET.forEach((r, i) => {
        const g3 = u.ribbon.geo3[i];
        if (g3 !== undefined)
          g3.w = Math.max(0, r.coc + (Math.abs(r.depth - focus) - Math.abs(r.depth)) * 8);
      });
      wind.update(blow(reactions.pointer, frameSize, dt, time), twist, u.lift.value);
      const span = frameSize.width / frameSize.height + 1.8;
      u.sweep.value = ((sweepClock / SWEEP_PERIOD) % 1) * span * 1.6 - span / 2 - 0.4;
      sinceCosmos += dt;
      if (sinceCosmos >= COSMOS_EVERY || dt === 0) {
        cosmos.render();
        sinceCosmos = 0;
      }
      picture.render();
    },
    dispose: () => {
      cosmos.dispose();
      picture.dispose();
      wind.texture.dispose();
    },
  };
}

export function mountSilk(host: HTMLElement, init: GpuBackdropInit): Promise<GpuBackdropScene> {
  return mountBackdrop(
    host,
    init,
    {
      bloom: { strength: 0.2, radius: 0.5 },
      lens: { aberration: 0.004, streak: 0, grain: 0.025 },
      // Painted to be seen as the prototype was, through a CSS mask over the page.
      fadeSpace: "display",
      feather: { sides: 0.1, top: 0.06, bottom: 0.45 },
    },
    silk,
  );
}
