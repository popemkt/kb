/**
 * The Floating geometry backdrop: one web of low-poly glass facets tiling a
 * deep navy field, gold light gathering where facets meet (shaders:
 * `floating-geometry-shader.ts`; the web: `web.ts`). Each mount lays out its
 * own web from its seed, two sheets of facets one over the other; they
 * slide a little and their vertices fold on clocks of their own, so the
 * composition holds.
 *
 * The glass fills the frame as the reference's fills its picture, and
 * dissolves by its own shapes at the reach's ragged rim. Each load varies
 * where the main knot sits, how large the glass is and a few degrees of the
 * light's hue (`variation`).
 *
 * The light: three lamps behind three knots, and a band of light that
 * sweeps across the glass every `SWEEP_PERIOD` seconds, so seam after seam
 * glints as it passes.
 *
 * The owner: the main lamp follows the pointer on a soft spring, so the
 * light moves through the facets under it, and with no pointer it wanders
 * near the main knot; the eye leans with the pointer too, so the near sheet
 * slides against the far one. Typing slows the drift and rests the sweep.
 * Writes are an impulse, never a restart: they swell the lamps, and a write
 * outside typing (`stir`) or a move to another page (`ripple`) folds the
 * glass a little further, which eases back.
 */
import { offscreenPass, type SceneStage } from "@kb/scene-gpu";
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
import { fillingReach } from "../gpu/dissolve";
import { textScrim } from "../gpu/text-scrim";
import {
  glassFragment,
  glassFrame,
  glassUniforms,
  type GlassUniforms,
} from "./floating-geometry-shader";
import { layoutWeb, placeSheets } from "./web";

/** The lamp's spring (ω, rad/s): it follows the pointer in about two seconds, as light through glass would drift. */
const FOLLOW = 2.4;
/** The most texels the glass is drawn at per CSS pixel: past this a seam is no crisper, only dearer. */
const TEXELS = 1.5;
/** How far the lamp wanders from its rest with no pointer (shares of the composition's scale), and how slowly (rad/s). */
const WANDER = 0.16;
const WANDER_RATE = 0.2;
/** The sweep crosses the glass this often (s), typing permitting. */
const SWEEP_PERIOD = 11;
/** The way the sweep travels: from the upper left down to the right. */
const SWEEP_DIR = { x: 0.894, y: -0.447 };
/** How much of the frame's reach the field fills whole before it dissolves: under half, so it fades over a long way. */
const SOLID = 0.42;
/** Each lamp's strength: the main one, then the two behind the next knots. */
const LAMP_STRENGTH = [1, 0.75, 0.55] as const;
/** The main lamp where it is, and the others at their knots, each breathing a little on a clock of its own. */
function writeLamps(
  u: GlassUniforms,
  lamp: { readonly x: number; readonly y: number },
  others: readonly { readonly x: number; readonly y: number }[],
  hub: { readonly x: number; readonly y: number; readonly scale: number },
  wander: number,
) {
  u.lamp[0]?.set(lamp.x, lamp.y, LAMP_STRENGTH[0], 0);
  others.forEach((knot, k) => {
    const turn = wander * (0.7 + 0.2 * k) + k * 2;
    u.lamp[k + 1]?.set(
      hub.x + (knot.x + 0.03 * Math.sin(turn)) * hub.scale,
      hub.y + (knot.y + 0.02 * Math.cos(turn * 1.3)) * hub.scale,
      (LAMP_STRENGTH[k + 1] ?? 0.5) * (0.85 + 0.15 * Math.sin(turn * 0.6)),
      0,
    );
  });
}

function floatingGeometry(stage: SceneStage, init: GpuBackdropInit): BackdropParts {
  const vary = variation(init.seed);
  const { sheets, knots } = layoutWeb(vary.stream("web"));
  /** Where the main knot sits off the composition's, and how large the glass is (shares of the scale). */
  const shift = { x: vary.range("knot.x", -0.12, 0.12), y: vary.range("knot.y", -0.06, 0.06) };
  const size = vary.range("size", 0.92, 1.1);
  const u = glassUniforms();
  u.hue.value.set(...hueTurn(vary.range("hue", -0.06, 0.06)));
  const scrim = textScrim();
  const glass = offscreenPass(stage.renderer, () => glassFragment(u), { history: false });
  stage.scene.backgroundNode = glassFrame(u, glass.picture, scrim, groundsOf(stage));
  /** Where the lamp rests against the main knot (shares of the scale). */
  const rest = { x: vary.range("lamp.x", 0.02, 0.08), y: vary.range("lamp.y", -0.08, -0.02) };
  /** The other lamps, behind the next two knots. */
  const others = knots.slice(1, 3).map(([x, y]) => ({ x, y }));

  let width = 1;
  let height = 1;
  let hub = { x: 0, y: 0, scale: 1 };
  const lamp = { x: 0, y: 0 };
  const velocity = { x: 0, y: 0 };
  let settled = false;
  let time = vary.range("clock", 0, 60);
  let wander = vary.phase("wander");
  let fold = 0;
  // A still rests with the sweep through the main knot; a running scene starts it off the glass.
  let sweepClock = init.reducedMotion ? SWEEP_PERIOD * 0.55 : 0;
  const lean = { x: 0, y: 0 };
  let span = 1;

  const place = () => {
    const placed = placeSheets(sheets, time, { ...hub, lean: [lean.x, lean.y] });
    placed.forEach((sheet, n) => {
      u.sheet[n * 2]?.set(sheet.x, sheet.y, sheet.cell, sheet.angle);
      u.sheet[n * 2 + 1]?.set(sheet.seed, sheet.crumple * (1 + fold), sheet.depth, 0);
    });
    // The piece lives on the near sheet: its knots slide with it, so its facets never change.
    const [dx, dy] = placed[0]?.slid ?? [0, 0];
    knots.forEach(([x, y, reach], k) =>
      u.knot[k]?.set(hub.x + x * hub.scale + dx, hub.y + y * hub.scale + dy, reach, 0),
    );
  };

  return {
    // In a panel the knot sits high and right, smaller and quieter; wide, right of the title.
    panel: { x: 0.72, y: 0.3, scale: 0.62, presence: 0.7 },
    wide: { x: 0.64, y: 0.44, scale: 1, presence: 1 },
    layout: ({ width: w, height: h, quality, composition }: BackdropLayout) => {
      width = w;
      height = h;
      const aspect = w / h;
      const scale = composition.scale * size;
      hub = {
        x: (composition.x - 0.5) * aspect + shift.x * scale,
        y: 0.5 - composition.y + shift.y * scale,
        scale,
      };
      u.scale.value = scale;
      if (!settled) {
        lamp.x = hub.x + rest.x * hub.scale;
        lamp.y = hub.y + rest.y * hub.scale;
        settled = true;
      }
      // The field fills the frame: cut under the app's bar, dissolving at its sides and bottom.
      u.reach.set(fillingReach(aspect, SOLID));
      u.window.value.set(-aspect / 2, -0.5, aspect / 2, 0.5);
      span = Math.abs(SWEEP_DIR.x) * aspect + Math.abs(SWEEP_DIR.y);
      // Crisp glass: a texel a device pixel at full quality, at most `TEXELS` a CSS pixel, fewer
      // as quality steps down.
      const texel = Math.min(stage.renderer.getPixelRatio(), TEXELS) * (0.5 + 0.5 * quality);
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
      // A write swells the lamps; a write outside typing, or a new page, folds the glass, and it eases back.
      fold += (0.5 * reactions.stir + 0.35 * reactions.ripple - fold) * Math.min(1, dt * 1.5);
      u.heat.value = 1 + 0.55 * reactions.impulse;
      u.time.value = time;
      writeLamps(u, lamp, others, hub, wander);
      place();
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
      bloom: { strength: 0.4, radius: 0.5 },
      // The glass dissolves within its own reach; the frame's feather is only the last guard.
      feather: { sides: 0.03, top: 0.02, bottom: 0.03 },
      lens: { aberration: 0.006, streak: 0, grain: 0.015 },
    },
    floatingGeometry,
  );
}
