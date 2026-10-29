/**
 * The Light trails backdrop: long-exposure streaks of light sweeping across
 * the head from the upper left down to the right, gathering in a white-hot
 * knot right of the title, over a deep navy field (shader:
 * `light-trails-shader.ts`; the strands: `trails.ts`). Each load varies the
 * strands a little and turns the hue a few degrees (`variation`).
 *
 * It fades by its own shapes: the field is the bundle's glow, the strands
 * die out one by one down the frame and all but go under the head's text,
 * and the frame's sides are the field's own (no feather there). In a panel
 * or on a phone the knot rests high and right, clear of the title.
 *
 * The owner: where the pointer rests the trails burn brighter, as if the
 * exposure were longer there, and the knot leans a little toward it on a
 * slow spring. The strands sway and their light runs on a clock that only
 * moves forward; typing slows it. Writes are an impulse, never a restart:
 * the packets of light that run along the strands brighten with it.
 */
import type { SceneStage } from "@kb/scene-gpu";
import type { Reactions } from "../scene/reactions";
import { hueTurn, variation } from "../scene/seed";
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
import { trailFrame, trailUniforms } from "./light-trails-shader";
import { layoutTrails } from "./trails";

/** The knot's spring toward the pointer (ω, rad/s), and how far it leans (frame units). */
const FOLLOW = 1.4;
const LEAN = 0.05;

function lightTrails(stage: SceneStage, init: GpuBackdropInit): BackdropParts {
  const vary = variation(init.seed);
  const strands = layoutTrails(vary.stream("strands"));
  const u = trailUniforms();
  u.turn.value.set(...hueTurn(vary.range("hue", -0.08, 0.08)));
  strands.forEach((s, i) => {
    u.shape[i]?.set(s.offset, s.fan, s.warm, s.depth);
    u.look[i]?.set(s.width, s.light, s.wave[0], s.wave[1]);
    u.end[i]?.set(s.low, 0, 0, 0);
  });
  const scrim = textScrim();
  stage.scene.backgroundNode = trailFrame(u, scrim, groundsOf(stage));

  let width = 1;
  let height = 1;
  let rest = { x: 0, y: 0, scale: 1 };
  const knot = { x: 0, y: 0 };
  const velocity = { x: 0, y: 0 };
  let time = vary.range("clock", 0, 200);

  const run = () =>
    strands.forEach((s, i) => {
      u.run[i]?.set(s.wave[2] + time * s.wave[3], s.gap[0], s.gap[1], s.pulse);
    });
  run();

  return {
    // In a panel the knot rests high and right, smaller, above the title's row; wide, right of the title.
    panel: { x: 0.3, y: 0.16, scale: 0.6, presence: 0.9 },
    wide: { x: 0.55, y: 0.42, scale: 1, presence: 1 },
    layout: (layout: BackdropLayout) => {
      const { width: w, height: h, anchor } = layout;
      width = w;
      height = h;
      rest = { x: anchor.x, y: anchor.y, scale: anchor.scale };
      knot.x = rest.x;
      knot.y = rest.y;
      u.knot.value.set(knot.x, knot.y, rest.scale);
      u.pixel.value = 1 / h;
      scrim.layout(layout);
      return rest;
    },
    setLook: (look: GpuLook) => {
      u.dark.value = look.dark ? 1 : 0;
      stage.setBloom(look.dark ? 0.25 : 0);
    },
    frame: (dt: number, reactions: Reactions) => {
      time += dt * (1 - 0.5 * reactions.calm);
      u.time.value = time;
      u.pulse.value = reactions.impulse;
      run();
      const pointer = reactions.pointer;
      const over = { x: (pointer.x - width / 2) / height, y: (height / 2 - pointer.y) / height };
      u.pointer.value.set(over.x, over.y, pointer.near);
      // The knot leans toward the pointer a little, on a spring; it comes home without one.
      const aim = {
        x: rest.x + Math.max(-1, Math.min(1, over.x - rest.x)) * LEAN * pointer.near,
        y: rest.y + Math.max(-1, Math.min(1, over.y - rest.y)) * LEAN * pointer.near,
      };
      if (dt > 0) {
        velocity.x += (FOLLOW * FOLLOW * (aim.x - knot.x) - 2 * FOLLOW * velocity.x) * dt;
        velocity.y += (FOLLOW * FOLLOW * (aim.y - knot.y) - 2 * FOLLOW * velocity.y) * dt;
        knot.x += velocity.x * dt;
        knot.y += velocity.y * dt;
      }
      u.knot.value.set(knot.x, knot.y, rest.scale);
    },
    dispose: () => undefined,
  };
}

export function mountLightTrails(
  host: HTMLElement,
  init: GpuBackdropInit,
): Promise<GpuBackdropScene> {
  return mountBackdrop(
    host,
    init,
    {
      bloom: { strength: 0.25, radius: 0.5 },
      lens: { aberration: 0.002, streak: 0.12, grain: 0.012 },
      // A painted scene: it fades into the page as a CSS mask would, by its own shapes; the frame's
      // feather is only the last guard, and none at the sides, which the field runs past.
      fadeSpace: "display",
      feather: { sides: 0.001, top: 0.03, bottom: 0.04 },
    },
    lightTrails,
  );
}
