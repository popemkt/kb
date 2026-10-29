/**
 * The Floating geometry backdrop: low-poly glass shards drifting slowly in
 * the dark, warm amber light coming through them (shaders:
 * `floating-geometry-shader.ts`; the shards: `shards.ts`). Each mount lays
 * out its own shards from its seed, fanned round a few knots where their
 * tips meet; they sway and drift on clocks of their own and never turn all
 * the way round, so the composition holds.
 *
 * The owner: the lamp behind the glass follows the pointer on a soft
 * spring, so the light moves through the facets under it, and with no
 * pointer it wanders slowly near the main knot. Typing slows the drift.
 * Writes are an impulse, never a restart: they swell the lamp, and a write
 * outside typing (`stir`) or a move to another page (`ripple`) leans every
 * shard a little further on its own swing, which eases back.
 */
import { offscreenPass, type SceneStage } from "@kb/scene-gpu";
import type { Reactions } from "../scene/reactions";
import { seededRng } from "../scene/rng";
import {
  mountBackdrop,
  type BackdropLayout,
  type BackdropParts,
  type GpuBackdropInit,
  type GpuBackdropScene,
  type GpuLook,
  groundsOf,
} from "../gpu/gpu-scene";
import { textScrim } from "../gpu/text-scrim";
import { glassFragment, glassFrame, glassUniforms } from "./floating-geometry-shader";
import { layoutShards, projectShards } from "./shards";

/** The lamp's spring (ω, rad/s): it follows the pointer in about two seconds, as light through glass would drift. */
const FOLLOW = 2.4;
/** How far the lamp wanders from its rest with no pointer (shares of the composition's scale), and how slowly (rad/s). */
const WANDER = 0.1;
const WANDER_RATE = 0.11;
/** How far the pass reaches past the frame, so a shard's halo is not cut at the edge. */
const MARGIN = 0.05;

function floatingGeometry(stage: SceneStage, init: GpuBackdropInit): BackdropParts {
  const rng = seededRng(init.seed);
  const { pieces, knots } = layoutShards(rng);
  const u = glassUniforms();
  const scrim = textScrim();
  const glass = offscreenPass(stage.renderer, () => glassFragment(u), { history: false });
  stage.scene.backgroundNode = glassFrame(u, glass.picture, scrim, groundsOf(stage));
  /** Where the lamp rests against the main knot (shares of the scale). */
  const rest = { x: rng.range(0.02, 0.08), y: rng.range(-0.08, -0.02) };
  /** The dimmer lamp, by the knot up and to the left of the main one. */
  const second = { x: knots[1]?.[0] ?? -0.5, y: knots[1]?.[1] ?? 0.3 };

  let width = 1;
  let height = 1;
  let hub = { x: 0, y: 0, scale: 1 };
  const lamp = { x: 0, y: 0 };
  const velocity = { x: 0, y: 0 };
  let settled = false;
  let time = rng.range(0, 60);
  let wander = rng.range(0, Math.PI * 2);
  let swirl = 0;

  const project = () => {
    const faces = projectShards(pieces, time, hub, [lamp.x, lamp.y], swirl);
    faces.forEach((face, i) => {
      u.face.corners[i * 2]?.set(face.a[0], face.a[1], face.b[0], face.b[1]);
      u.face.corners[i * 2 + 1]?.set(face.c[0], face.c[1], face.depth, face.lit);
      u.face.edges[i]?.set(face.edges[0], face.edges[1], face.edges[2], 0);
    });
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
      u.window.value.set(-aspect / 2 - MARGIN, -0.5 - MARGIN, aspect / 2 + MARGIN, 0.5 + MARGIN);
      // Soft glass: at full quality about a texel a CSS pixel.
      const texel = 0.55 + 0.45 * quality;
      glass.setSize((w + 2 * MARGIN * h) * texel, (h + 2 * MARGIN * h) * texel);
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
      feather: { sides: 0.18, top: 0.08, bottom: 0.5 },
      lens: { aberration: 0.006, streak: 0, grain: 0.015 },
    },
    floatingGeometry,
  );
}
