/**
 * The Floating geometry backdrop: one web of low-poly glass facets tiling a
 * deep navy field, gold light gathering where facets meet (shaders:
 * `floating-geometry-shader.ts`; the web: `web.ts`). Each mount lays out its
 * own web from its seed, three sheets of facets one over another; they
 * slide a little and their vertices fold on clocks of their own, so the
 * composition holds.
 *
 * The piece hangs right of the title, the whole cluster inside the head's
 * band, never cut by an edge (`fitPiece`, `BAND`). Behind it the hazed web and the air span the scroll
 * region: the lit air dissolves by its own round reach about the piece,
 * and the web and its haze cross the whole frame, thinning out facet by
 * facet toward its sides and bottom and under the text (`FIELD`). Each load varies where the main knot sits, how
 * large the glass is and a few degrees of the light's hue (`variation`).
 *
 * The light: three lamps behind three knots, far glints in the web behind
 * (the shader's), and a band of light that
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
import { farField, glowAbout, type FieldReach } from "../gpu/dissolve";
import { textScrim } from "../gpu/text-scrim";
import {
  fieldFragment,
  glassFrame,
  glassUniforms,
  pieceFragment,
  type GlassUniforms,
} from "./floating-geometry-shader";
import { fitPiece, layoutWeb, pieceBounds, placeSheets, type PieceBounds } from "./web";
import type { Anchor } from "../gpu/framing";

/** How strongly the light blooms on a dark page: the glints and the seams that meet there carry the frame. */
const BLOOM = 0.5;
/** The lamp's spring (ω, rad/s): it follows the pointer in about two seconds, as light through glass would drift. */
const FOLLOW = 2.4;
/** The most texels the glass is drawn at per CSS pixel: past this a seam is no crisper, only dearer. */
const TEXELS = 1.5;
/** The texels the field is drawn at per CSS pixel: a far layer, out of focus, so a few are enough. */
const FIELD_TEXELS = 0.5;
/**
 * Where the far web's facets thin out: over a little of the frame at either
 * side, so the field reaches the title's side and its glints stand there,
 * and low in it, under the head's rows.
 */
const FIELD: FieldReach = { sides: 0.4, low: [-0.34, 0.18] };
/** How far the lamp wanders from its rest with no pointer (shares of the composition's scale), and how slowly (rad/s). */
const WANDER = 0.09;
const WANDER_RATE = 0.2;
/** The sweep crosses the glass this often (s), typing permitting. */
const SWEEP_PERIOD = 11;
/** The way the sweep travels: from the upper left down to the right. */
const SWEEP_DIR = { x: 0.894, y: -0.447 };
/**
 * The field is the air the lamps light about the piece: how far it reaches
 * from the main knot (frame units, then shares of the scale), and how much
 * of that is whole before it dissolves: little, so it fades over a long way.
 */
const AIR = { x: 0.5, y: 0.55, grow: 0.8 } as const;
const SOLID = 0.08;
/** Each lamp's strength: the main one, the hot point, then two quieter ones behind the next knots, each a glint of its own. */
const LAMP_STRENGTH = [1, 0.62, 0.42] as const;
/**
 * The frame's feather (shares of its width and height): none at the sides,
 * which are the scroll region's own (the haze is full-bleed and the far web
 * thins out by its facets), a guard at the top and bottom.
 */
const FEATHER = { sides: 0, top: 0.02, bottom: 0.03 } as const;
/**
 * How far inside the frame the piece's facets keep: at the sides a share of
 * its width and room; at the top the strip under the app's bar; at the
 * bottom the head's rows (frame units). So the whole cluster sits in the
 * head's band, never cut by an edge.
 */
const SIDE_SHARE = 0.03;
const EDGE_ROOM = 0.04;
const BAND = { top: 0.04, bottom: 0.2 } as const;
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

/** Where the piece hangs: the composition's knot, this load's shift and size, fitted whole inside the frame (`fitPiece`). */
function hubFor(
  bounds: PieceBounds,
  load: { readonly shift: { readonly x: number; readonly y: number }; readonly size: number },
  anchor: Anchor,
  aspect: number,
) {
  const wanted = anchor.scale * load.size;
  return fitPiece(
    bounds,
    {
      x: anchor.x + load.shift.x * wanted,
      y: anchor.y + load.shift.y * wanted,
      scale: wanted,
    },
    aspect,
    { sides: SIDE_SHARE * aspect + EDGE_ROOM, ...BAND },
  );
}

/** The field's reach: the lit air about the piece, dissolving by its own round shape. */
const airAbout = (aspect: number, hub: { x: number; y: number; scale: number }) =>
  glowAbout(
    aspect,
    hub,
    { x: AIR.x + AIR.grow * hub.scale, y: AIR.y + AIR.grow * 0.4 * hub.scale },
    SOLID,
  );

/**
 * The glass's two offscreen passes, the field behind and the piece in
 * front, composed in the frame: sized for the frame and its quality, drawn
 * each frame, the field first.
 */
function glassPasses(stage: SceneStage, u: GlassUniforms, scrim: ReturnType<typeof textScrim>) {
  const field = offscreenPass(stage.renderer, () => fieldFragment(u), { history: false });
  const glass = offscreenPass(stage.renderer, () => pieceFragment(u), { history: false });
  stage.scene.backgroundNode = glassFrame(
    u,
    { field: field.picture, piece: glass.picture },
    scrim,
    groundsOf(stage),
  );
  return {
    setSize: (w: number, h: number, quality: number) => {
      // Crisp glass: a texel a device pixel at full quality, at most `TEXELS` a CSS pixel, fewer
      // as quality steps down. The field is out of focus, so a few texels do.
      const texel = Math.min(stage.renderer.getPixelRatio(), TEXELS) * (0.5 + 0.5 * quality);
      glass.setSize(w * texel, h * texel);
      u.pixel.value = 1 / (h * texel);
      field.setSize(w * FIELD_TEXELS, h * FIELD_TEXELS);
      u.fieldPixel.value = 1 / (h * FIELD_TEXELS);
    },
    render: () => {
      field.render();
      glass.render();
    },
    dispose: () => {
      field.dispose();
      glass.dispose();
    },
  };
}

function floatingGeometry(stage: SceneStage, init: GpuBackdropInit): BackdropParts {
  const vary = variation(init.seed);
  const web = layoutWeb(vary.stream("web"));
  const { sheets, knots } = web;
  const bounds = pieceBounds(web);
  /** Where the main knot sits off the composition's, and how large the glass is (shares of the scale). */
  const shift = { x: vary.range("knot.x", -0.12, 0.12), y: vary.range("knot.y", -0.06, 0.06) };
  const size = vary.range("size", 0.92, 1.1);
  const scrim = textScrim();
  const u = glassUniforms(farField(scrim, FIELD));
  u.hue.value.set(...hueTurn(vary.range("hue", -0.06, 0.06)));
  const passes = glassPasses(stage, u, scrim);
  /** Where the lamp rests against the main knot, on the corner there (shares of the scale). */
  const rest = { x: vary.range("lamp.x", -0.02, 0.02), y: vary.range("lamp.y", -0.02, 0.02) };
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
    // In a panel the piece sits high above the title, smaller and quieter; wide, right of the title
    // at its height, the whole cluster in the band (`fitPiece`).
    panel: { x: 0.06, y: 0.2, scale: 0.6, presence: 0.75 },
    wide: { x: 0.55, y: 0.4, scale: 1, presence: 1 },
    layout: (layout: BackdropLayout) => {
      const { width: w, height: h, quality, anchor } = layout;
      width = w;
      height = h;
      const aspect = w / h;
      // The piece is whole: slid in, and smaller only if it must be, to clear the sides and bottom.
      hub = hubFor(bounds, { shift, size }, anchor, aspect);
      u.scale.value = hub.scale;
      if (!settled) {
        lamp.x = hub.x + rest.x * hub.scale;
        lamp.y = hub.y + rest.y * hub.scale;
        settled = true;
      }
      u.reach.set(airAbout(aspect, hub));
      u.window.value.set(-aspect / 2, -0.5, aspect / 2, 0.5);
      u.field.layout(aspect);
      span = Math.abs(SWEEP_DIR.x) * aspect + Math.abs(SWEEP_DIR.y);
      passes.setSize(w, h, quality);
      scrim.layout(layout);
      return hub;
    },
    setLook: (look: GpuLook) => {
      u.dark.value = look.dark ? 1 : 0;
      stage.setBloom(look.dark ? BLOOM : 0);
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
      passes.render();
    },
    dispose: passes.dispose,
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
      bloom: { strength: BLOOM, radius: 0.5 },
      // The glass dissolves within its own reach; the frame's feather is only the last guard.
      feather: FEATHER,
      lens: { aberration: 0.006, streak: 0, grain: 0.015 },
    },
    floatingGeometry,
  );
}
