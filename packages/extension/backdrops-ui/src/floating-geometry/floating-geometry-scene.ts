/**
 * The Floating geometry backdrop: low-poly glass shards drifting slowly in
 * the dark, warm amber light coming through them (shaders:
 * `floating-geometry-shader.ts`; the shards: `shards.ts`). Each mount lays
 * out its own shards from its seed, fanned round a few knots where their
 * tips meet; they sway and drift on clocks of their own and never turn all
 * the way round, so the composition holds.
 *
 * The light: a lamp behind the main knot, and a band of light that sweeps
 * across the glass every `SWEEP_PERIOD` seconds, so edge after edge glints
 * as it passes.
 *
 * The owner: the lamp behind the glass follows the pointer on a soft
 * spring, so the light moves through the facets under it, and with no
 * pointer it wanders near the main knot; the eye leans with the pointer too,
 * so the near shards slide against the far ones. Typing slows the drift and
 * rests the sweep.
 * Writes are an impulse, never a restart: they swell the lamp, and a write
 * outside typing (`stir`) or a move to another page (`ripple`) leans every
 * shard a little further on its own swing, which eases back.
 */
import { offscreenPass, type SceneStage } from "@kb/scene-gpu";
import type { Reactions } from "../scene/reactions";
import { variation } from "../scene/seed";
import {
  mountBackdrop,
  type BackdropLayout,
  type BackdropParts,
  type GpuBackdropInit,
  type GpuBackdropScene,
  type GpuLook,
  groundsOf,
} from "../gpu/gpu-scene";
import { keptAt, reachWithin, type Reach } from "../gpu/dissolve";
import { textScrim } from "../gpu/text-scrim";
import {
  glassFragment,
  glassFrame,
  glassUniforms,
  type GlassUniforms,
} from "./floating-geometry-shader";
import { layoutShards, projectShards, type ProjectedFace } from "./shards";

/** The lamp's spring (ω, rad/s): it follows the pointer in about two seconds, as light through glass would drift. */
const FOLLOW = 2.4;
/** How far the lamp wanders from its rest with no pointer (shares of the composition's scale), and how slowly (rad/s). */
const WANDER = 0.16;
const WANDER_RATE = 0.2;
/** The sweep crosses the glass this often (s), typing permitting. */
const SWEEP_PERIOD = 11;
/** The way the sweep travels: from the upper left down to the right. */
const SWEEP_DIR = { x: 0.894, y: -0.447 };
/** How far the glass may spread about the main knot before it has dissolved (shares of the scale). */
const REACH = { x: 1.25, y: 0.62 };
/** How far past its corners anything of a face shows (frame units): its edges' halo and its tip's flare. */
const BOX_MARGIN = 0.12;

/** The faces as the shader reads them: corners, light, edges, how much of each is kept, and its box. */
function writeFaces(u: GlassUniforms, faces: readonly ProjectedFace[], reach: Reach) {
  faces.forEach((face, i) => {
    u.face.corners[i * 2]?.set(face.a[0], face.a[1], face.b[0], face.b[1]);
    u.face.corners[i * 2 + 1]?.set(face.c[0], face.c[1], face.depth, face.lit);
    // A face far out in the reach fades as a whole, so the glass dissolves shard by shard.
    const mid = [(face.a[0] + face.b[0] + face.c[0]) / 3, (face.a[1] + face.b[1] + face.c[1]) / 3];
    const kept = keptAt(reach, mid[0] ?? 0, mid[1] ?? 0);
    u.face.edges[i]?.set(face.edges[0], face.edges[1], face.edges[2], kept);
    const xs = [face.a[0], face.b[0], face.c[0]];
    const ys = [face.a[1], face.b[1], face.c[1]];
    // A face that is gone, or a spare, has an empty box: no pixel spends anything on it.
    if (kept <= 0 || Math.min(...xs) === Math.max(...xs)) u.face.boxes[i]?.set(1, 1, -1, -1);
    else
      u.face.boxes[i]?.set(
        Math.min(...xs) - BOX_MARGIN,
        Math.min(...ys) - BOX_MARGIN,
        Math.max(...xs) + BOX_MARGIN,
        Math.max(...ys) + BOX_MARGIN,
      );
  });
}

function floatingGeometry(stage: SceneStage, init: GpuBackdropInit): BackdropParts {
  const vary = variation(init.seed);
  const { pieces, knots } = layoutShards(vary.stream("shards"));
  const u = glassUniforms();
  const scrim = textScrim();
  const glass = offscreenPass(stage.renderer, () => glassFragment(u), { history: false });
  stage.scene.backgroundNode = glassFrame(u, glass.picture, scrim, groundsOf(stage));
  /** Where the lamp rests against the main knot (shares of the scale). */
  const rest = { x: vary.range("lamp.x", 0.02, 0.08), y: vary.range("lamp.y", -0.08, -0.02) };
  /** The dimmer lamp, by the knot up and to the left of the main one. */
  const second = { x: knots[1]?.[0] ?? -0.5, y: knots[1]?.[1] ?? 0.3 };

  let width = 1;
  let height = 1;
  let hub = { x: 0, y: 0, scale: 1 };
  let reach: Reach = { x: 0, y: 0, rx: 1, ry: 1 };
  const lamp = { x: 0, y: 0 };
  const velocity = { x: 0, y: 0 };
  let settled = false;
  let time = vary.range("clock", 0, 60);
  let wander = vary.phase("wander");
  let swirl = 0;
  // A still rests with the sweep through the main knot; a running scene starts it off the glass.
  let sweepClock = init.reducedMotion ? SWEEP_PERIOD * 0.55 : 0;
  const lean = { x: 0, y: 0 };
  let span = 1;

  const project = () => {
    const faces = projectShards(
      pieces,
      time,
      { ...hub, lean: [lean.x, lean.y] },
      [lamp.x, lamp.y],
      swirl,
    );
    writeFaces(u, faces, reach);
  };

  return {
    // In a panel the knot sits high and right, smaller and quieter; wide, right of the title.
    panel: { x: 0.72, y: 0.3, scale: 0.62, presence: 0.7 },
    wide: { x: 0.64, y: 0.44, scale: 1, presence: 1 },
    layout: ({ width: w, height: h, quality, composition }: BackdropLayout) => {
      width = w;
      height = h;
      const aspect = w / h;
      hub = { x: (composition.x - 0.5) * aspect, y: 0.5 - composition.y, scale: composition.scale };
      u.scale.value = composition.scale;
      u.hub.value.set(hub.x, hub.y);
      if (!settled) {
        lamp.x = hub.x + rest.x * hub.scale;
        lamp.y = hub.y + rest.y * hub.scale;
        settled = true;
      }
      reach = reachWithin(aspect, hub, { x: REACH.x * hub.scale, y: REACH.y * hub.scale });
      u.reach.set(reach);
      u.window.value.set(-aspect / 2, -0.5, aspect / 2, 0.5);
      span = Math.abs(SWEEP_DIR.x) * aspect + Math.abs(SWEEP_DIR.y);
      // Crisp glass: a texel a device pixel at full quality, fewer as quality steps down.
      const texel = stage.renderer.getPixelRatio() * (0.5 + 0.5 * quality);
      glass.setSize(w * texel, h * texel);
      u.pixel.value = 1 / (h * texel);
      scrim.layout(w, h);
    },
    setLook: (look: GpuLook) => {
      u.dark.value = look.dark ? 1 : 0;
      stage.setBloom(look.dark ? 0.4 : 0);
    },
    frame: (dt: number, reactions: Reactions) => {
      // Typing slows the drift; the clock only runs forward.
      time += dt * (1 - 0.6 * reactions.calm);
      wander += dt * WANDER_RATE;
      const pointer = reactions.pointer;
      const home = {
        x: hub.x + (rest.x + WANDER * Math.cos(wander)) * hub.scale,
        y: hub.y + (rest.y + WANDER * 0.6 * Math.sin(wander * 1.3)) * hub.scale,
      };
      const over = {
        x: (pointer.x - width / 2) / height,
        y: (height / 2 - pointer.y) / height,
      };
      const aim = {
        x: home.x + (over.x - home.x) * pointer.near,
        y: home.y + (over.y - home.y) * pointer.near,
      };
      if (dt > 0) {
        velocity.x += (FOLLOW * FOLLOW * (aim.x - lamp.x) - 2 * FOLLOW * velocity.x) * dt;
        velocity.y += (FOLLOW * FOLLOW * (aim.y - lamp.y) - 2 * FOLLOW * velocity.y) * dt;
        lamp.x += velocity.x * dt;
        lamp.y += velocity.y * dt;
      }
      // The eye leans toward the pointer, and drifts a little of its own accord without one.
      const ease = 1 - Math.exp(-dt * 2);
      const idle = { x: 0.25 * Math.sin(wander * 0.8), y: 0.12 * Math.cos(wander * 0.6) };
      lean.x += ((over.x - hub.x) * pointer.near + idle.x * (1 - pointer.near) - lean.x) * ease;
      lean.y += ((over.y - hub.y) * pointer.near + idle.y * (1 - pointer.near) - lean.y) * ease;
      sweepClock += dt * (1 - 0.9 * reactions.calm);
      // Across the whole frame and a little past either side, so it enters and leaves unseen.
      u.sweep.value = ((sweepClock / SWEEP_PERIOD) % 1) * (span + 0.8) - (span + 0.8) / 2;
      // A write swells the lamp; a write outside typing, or a new page, leans the shards, and they ease back.
      swirl += (0.5 * reactions.stir + 0.35 * reactions.ripple - swirl) * Math.min(1, dt * 1.5);
      u.heat.value = 1 + 0.55 * reactions.impulse;
      u.time.value = time;
      u.lamp.value.set(lamp.x, lamp.y);
      // The second lamp keeps to its knot, breathing a little on a clock of its own.
      u.second.value.set(
        hub.x + (second.x + 0.03 * Math.sin(wander * 0.7)) * hub.scale,
        hub.y + (second.y + 0.02 * Math.cos(wander * 0.9)) * hub.scale,
      );
      project();
      glass.render();
    },
    dispose: glass.dispose,
  };
}

export function mountFloatingGeometry(
  host: HTMLElement,
  init: GpuBackdropInit,
): Promise<GpuBackdropScene> {
  return mountBackdrop(
    host,
    init,
    {
      bloom: { strength: 0.4, radius: 0.6 },
      // The glass dissolves within its own reach; the frame's feather is only the last guard.
      feather: { sides: 0.03, top: 0.03, bottom: 0.03 },
      lens: { aberration: 0.006, streak: 0, grain: 0.015 },
    },
    floatingGeometry,
  );
}
