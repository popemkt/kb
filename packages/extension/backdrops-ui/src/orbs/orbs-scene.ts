/**
 * The Gradient orbs backdrop: two great glowing spheres floating slowly in
 * front of a deep blue field, the light of their glows (shader: `orbs-shader.ts`;
 * the orbs: `orbs.ts`). Each load varies the reference composition a little
 * and turns its hue a few degrees (`variation`).
 *
 * The owner: the lamp that lights the orbs follows the pointer on a slow
 * spring, so they turn their lit faces toward it, and wanders at the upper
 * right without one. The eye leans with the pointer too, and idly without
 * one, so the near orb slides against the far ones and the field. The orbs
 * drift nearer and part, and the hue leans and returns on a slow clock
 * (`HUE_PERIOD`). Typing slows the drift. Writes are an impulse, never a
 * restart: the orbs breathe out a little and their glow lifts with it, and
 * ease back.
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
import { farField, glowAbout, type FieldReach } from "../gpu/dissolve";
import { textScrim } from "../gpu/text-scrim";
import { orbFrame, orbUniforms } from "./orbs-shader";
import { layoutOrbs, litToward, placeOrbs } from "./orbs";

/** The lamp's spring (ω, rad/s): slow, so the light swings round the orbs rather than snapping. */
const FOLLOW = 1.6;
/** Where the lamp rests with no pointer: high at the right, beyond the great orb (frame units from the composition), and its height, high enough that its light falls off across each orb's whole face. */
const LAMP_REST = { x: 1.5, y: 0.5 } as const;
const LAMP_HEIGHT = 0.8;
/** How far and how slowly it wanders there (frame units, rad/s). */
const WANDER = 0.14;
const WANDER_RATE = 0.12;
/**
 * Where the far orbs thin out: never toward the sides, so the field is
 * full-bleed across the scroll region, and low in the frame, under the
 * head's rows.
 */
const FIELD: FieldReach = { sides: 0, low: [-0.45, 0.05] };
/** The most of an orb's glow that is whole, however near the frame's bottom has shrunk it. */
const SOLID_MOST = 0.85;
/** The hue leans and returns this often (s). */
const HUE_PERIOD = 48;

function gradientOrbs(stage: SceneStage, init: GpuBackdropInit): BackdropParts {
  const vary = variation(init.seed);
  const orbs = layoutOrbs(vary.stream("orbs"));
  const scrim = textScrim();
  const u = orbUniforms(farField(scrim, FIELD));
  u.turn.value.set(...hueTurn(vary.range("hue", -0.1, 0.1)));
  stage.scene.backgroundNode = orbFrame(u, scrim, groundsOf(stage));

  let width = 1;
  let height = 1;
  let frame = { x: 0, y: 0, scale: 1 };
  const lamp = { x: 0, y: 0 };
  const velocity = { x: 0, y: 0 };
  let settled = false;
  let time = vary.range("clock", 0, 120);
  let wander = vary.phase("wander");
  const lean = { x: 0, y: 0 };

  return {
    // In a panel the orbs are small and high, the great one whole in the top right corner, off
    // the title and the first rows, which cross the whole frame; wide, the great orb right of the
    // title, cut by the frame's top.
    panel: { x: 0.1, y: 0.39, scale: 0.3, presence: 0.9 },
    wide: { x: 0, y: 0.5, scale: 1, presence: 1 },
    layout: (layout: BackdropLayout) => {
      const { width: w, height: h, anchor } = layout;
      width = w;
      height = h;
      frame = { x: anchor.x, y: anchor.y, scale: anchor.scale };
      if (!settled) {
        lamp.x = frame.x + LAMP_REST.x * frame.scale;
        lamp.y = frame.y + LAMP_REST.y * frame.scale;
        settled = true;
      }
      u.field.layout(w / h);
      scrim.layout(layout);
      return frame;
    },
    setLook: (look: GpuLook) => {
      u.dark.value = look.dark ? 1 : 0;
      stage.setBloom(look.dark ? 0.3 : 0);
    },
    frame: (dt: number, reactions: Reactions) => {
      time += dt * (1 - 0.6 * reactions.calm);
      wander += dt * WANDER_RATE;
      const pointer = reactions.pointer;
      const rest = {
        x: frame.x + (LAMP_REST.x + WANDER * Math.cos(wander)) * frame.scale,
        y: frame.y + (LAMP_REST.y + WANDER * 0.5 * Math.sin(wander * 1.4)) * frame.scale,
      };
      const over = { x: (pointer.x - width / 2) / height, y: (height / 2 - pointer.y) / height };
      const aim = {
        x: rest.x + (over.x - rest.x) * pointer.near,
        y: rest.y + (over.y - rest.y) * pointer.near,
      };
      if (dt > 0) {
        velocity.x += (FOLLOW * FOLLOW * (aim.x - lamp.x) - 2 * FOLLOW * velocity.x) * dt;
        velocity.y += (FOLLOW * FOLLOW * (aim.y - lamp.y) - 2 * FOLLOW * velocity.y) * dt;
        lamp.x += velocity.x * dt;
        lamp.y += velocity.y * dt;
      }
      u.lamp.value.set(lamp.x, lamp.y, LAMP_HEIGHT);
      u.glow.value = 1 + 0.6 * reactions.impulse;
      u.time.value = time;
      u.hue.value = 0.5 - 0.5 * Math.cos((Math.PI * 2 * time) / HUE_PERIOD);
      // The eye leans toward the pointer, and drifts a little of its own accord without one.
      const ease = 1 - Math.exp(-dt * 2);
      const idle = { x: 0.3 * Math.sin(wander * 0.7), y: 0.15 * Math.cos(wander * 0.5) };
      lean.x += ((over.x - frame.x) * pointer.near + idle.x * (1 - pointer.near) - lean.x) * ease;
      lean.y += ((over.y - frame.y) * pointer.near + idle.y * (1 - pointer.near) - lean.y) * ease;
      placeOrbs(orbs, time, { ...frame, lean: [lean.x, lean.y] }, reactions.impulse).forEach(
        (orb, i) => {
          u.placed[i]?.set(orb.x, orb.y, orb.r, orb.light);
          u.lit[i]?.set(...litToward(orb, lamp), 0, 0);
          u.depth[i] = orb.depth;
          // The field is the orbs' glows: each round its orb, as far as the frame has room, and
          // whole out to the orb's own limb, so the orb always sits in its light, never on the page.
          const reach = orb.r + orb.halo;
          const glow = glowAbout(width / height, orb, { x: reach, y: reach }, 0);
          u.reaches[i]?.set({ ...glow, solid: Math.min(SOLID_MOST, orb.r / glow.rx) });
        },
      );
    },
    dispose: () => undefined,
  };
}

export function mountGradientOrbs(
  host: HTMLElement,
  init: GpuBackdropInit,
): Promise<GpuBackdropScene> {
  return mountBackdrop(
    host,
    init,
    {
      bloom: { strength: 0.3, radius: 0.8 },
      lens: { aberration: 0, streak: 0, grain: 0.012 },
      // A painted scene: it fades into the page as a CSS mask would. Its field is full-bleed to
      // the scroll region's sides, which are the frame's, and dissolves low by its own round
      // glows; the top and bottom feather is only the last guard.
      fadeSpace: "display",
      feather: { sides: 0, top: 0.03, bottom: 0.03 },
    },
    gradientOrbs,
  );
}
