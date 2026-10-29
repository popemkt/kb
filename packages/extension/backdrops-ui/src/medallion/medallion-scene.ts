/**
 * The wolf medallion backdrop: kb's own steel wolf sigil over drifting
 * smoke and rising embers, a faint circle of five glyphs turning behind it
 * (shader: `medallion-shader.ts`; the geometry: `medallion.ts`).
 *
 * The medallion senses the page. When something happens that the owner did
 * not do here (`Reactions.notice`: a change arriving from elsewhere, an
 * error, the sidebar's agent finishing a turn), it trembles for a moment and
 * its eyes flare in that event's colour. Under reduced motion it never
 * moves: its eyes light, still, and go dark again a few seconds later (two
 * still frames). The pointer near it wakes its eyes a little; typing slows
 * the smoke; writes turn the circle a little faster for a while. At rest it
 * swings a little on its chain (`SWING`), the smoke rises and the embers
 * climb. Near it, smoke and embers dissolve within a reach about it; far
 * from it, plumes of smoke, sparks and glyph haze cross the scroll region,
 * each fading whole where it stands (`FIELD`).
 */
import type { SceneStage } from "@kb/scene-gpu";
import { logWarn } from "@kb/ui-sdk";
import type { PageEventKind, Reactions } from "../scene/reactions";
import { TAU } from "../scene/math";
import {
  mountBackdrop,
  type BackdropLayout,
  type BackdropParts,
  type GpuBackdropInit,
  type GpuBackdropScene,
  type GpuLook,
  groundsOf,
} from "../gpu/gpu-scene";
import { farField, reachWithin, type FieldReach } from "../gpu/dissolve";
import { variation } from "../scene/seed";
import { textScrim } from "../gpu/text-scrim";
import { TURN_SECONDS, tremble } from "./medallion";
import { medallionFrame, medallionUniforms } from "./medallion-shader";
import { SIGIL_BAIL, bakedRelief, loadReliefArt, type BakedRelief, type ReliefArt } from "./relief";

type Rgb = readonly [number, number, number];

/** The eyes' light at rest, and the colour each event flares them in. */
const REST: Rgb = [1, 0.55, 0.2];
export const FLARES: Readonly<Record<PageEventKind, Rgb>> = {
  // A change from elsewhere: a cold silver, something moving out there.
  arrivals: [0.55, 0.75, 1],
  // An error: red.
  errors: [1, 0.16, 0.08],
  // The agent finished a turn: gold.
  turns: [1, 0.68, 0.24],
};
/** The eyes' glow at rest, and what the pointer near adds. */
const GLOW_REST = 0.2;
const GLOW_NEAR = 0.15;
/** The disk's radius at full scale (frame heights). */
const RADIUS = 0.27;
/** How far the medallion swings on its chain (rad) and how often (s). */
const SWING = { angle: 0.08, period: 7.5 } as const;
/** How far the smoke and embers spread about the disk before they have dissolved (radii). */
const REACH = { x: 3.4, y: 2.2 } as const;
/** How much of the reach the smoke fills whole: a subject in the open, so little. */
const SOLID = 0.4;
/**
 * Where the far layers (plumes of smoke, sparks, glyph haze) thin out
 * across the frame: over its outer heights at either side, and low in it.
 */
const FIELD: FieldReach = { sides: 0.9, low: [-0.4, 0.02] };
/** How far it leans toward the pointer, per frame height the pointer is away (medallion units). */
const LEAN = 0.05;
/** How far above the frame's top it hangs from (medallion units). */
const PIVOT_ABOVE = 0.4;
/** Under reduced motion: how long the eyes stay lit, still (ms). */
const HELD_MS = 3500;

/**
 * The art a relief is baked from: kb's sigil (null), or an image the art
 * setting names. `shown` hears where the art's top lies (the chain's bail).
 */
function reliefArt(relief: BakedRelief, shown: (bail: number) => void) {
  let art: string | null = null;
  let image: ReliefArt | null = null;
  const show = (next: ReliefArt | null) => {
    image?.texture.dispose();
    image = next;
    relief.setArt(next);
    shown(next === null ? SIGIL_BAIL.y + SIGIL_BAIL.radius : next.top);
  };
  show(null);
  return {
    /** Settles once the art asked for is shown (or has failed, leaving the sigil). */
    choose: async (url: string | null): Promise<void> => {
      if (url === art) return;
      art = url;
      if (url === null) {
        show(null);
        return;
      }
      try {
        const loaded = await loadReliefArt(url);
        if (art === url) show(loaded);
        else loaded.texture.dispose();
      } catch (error: unknown) {
        // Art that will not load leaves the sigil: a backdrop never fails a page.
        logWarn("backdrop art", error);
        if (art === url) show(null);
      }
    },
    /** An image still loading is dropped when it lands. */
    dispose: () => {
      art = null;
      image?.texture.dispose();
    },
  };
}

function wolfMedallion(stage: SceneStage, init: GpuBackdropInit): BackdropParts {
  const vary = variation(init.seed);
  const scrim = textScrim();
  const u = medallionUniforms(farField(scrim, FIELD));
  const relief = bakedRelief(stage.renderer);
  const chosen = reliefArt(relief, (bail) => {
    u.bail.value = bail;
    stage.invalidate();
  });
  // The first frame shown is already the art asked for: never the sigil, then the image.
  const ready = chosen.choose(init.art);
  stage.scene.backgroundNode = medallionFrame(u, relief, scrim, groundsOf(stage));

  let width = 1;
  let height = 1;
  let rest = { x: 0, y: 0 };
  let radius = RADIUS;
  // A still is curated; a moving scene starts somewhere of its own.
  let time = init.reducedMotion ? 30 : vary.range("clock", 0, 330);
  let turn = (time / TURN_SECONDS) * TAU;
  let seen = 0;
  let since = Infinity;
  let kind: PageEventKind | null = null;
  let heldUntil = 0;
  let wake: ReturnType<typeof setTimeout> | undefined;

  return {
    // In a panel the medallion stands high and right, smaller; wide, right of the title.
    panel: { x: 0.24, y: 0.4, scale: 0.68, presence: 0.9 },
    wide: { x: 0.5, y: 0.47, scale: 1, presence: 1 },
    layout: (layout: BackdropLayout) => {
      const { width: w, height: h, anchor } = layout;
      width = w;
      height = h;
      rest = { x: anchor.x, y: anchor.y };
      radius = RADIUS * anchor.scale;
      u.radius.value = radius;
      u.centre.value.set(rest.x, rest.y);
      // It hangs from above the frame's top, so the chain runs out of the frame.
      u.pivot.value = (0.5 - rest.y) / radius + PIVOT_ABOVE;
      u.reach.set(reachWithin(w / h, rest, { x: REACH.x * radius, y: REACH.y * radius }, SOLID));
      u.field.layout(w / h);
      scrim.layout(layout);
      return { ...rest, scale: anchor.scale };
    },
    ready,
    setLook: (look: GpuLook) => {
      void chosen.choose(look.art);
      u.dark.value = look.dark ? 1 : 0;
      stage.setBloom(look.dark ? 0.35 : 0);
    },
    frame: (dt: number, reactions: Reactions) => {
      const still = stage.reduced();
      time += dt * (1 - 0.5 * reactions.calm);
      turn += ((dt * TAU) / TURN_SECONDS) * (1 + 3 * reactions.stir);
      if (reactions.noticed.count !== seen) {
        seen = reactions.noticed.count;
        kind = reactions.noticed.kind;
        since = 0;
        if (still) {
          // Lit now, and drawn dark again once the hold is up: the stage draws a still only when asked.
          heldUntil = performance.now() + HELD_MS;
          clearTimeout(wake);
          wake = setTimeout(() => stage.invalidate(), HELD_MS + 30);
        }
      } else {
        since += dt;
      }
      const flare = still ? (performance.now() < heldUntil ? 1 : 0) : reactions.startle;
      const pointer = reactions.pointer;
      // The pointer near the disk wakes its eyes a little.
      const off = Math.hypot(
        (pointer.x - width / 2) / height - rest.x,
        (height / 2 - pointer.y) / height - rest.y,
      );
      const near = pointer.near * Math.exp(-((off / (radius * 3)) ** 2));
      // It leans a little toward the pointer, over a field that stays: parallax, so it stands in front.
      const toward = still ? 0 : pointer.near * LEAN;
      const step = Math.min(1, dt * 4);
      u.lean.value.set(
        u.lean.value.x +
          (((pointer.x - width / 2) / height - rest.x) * toward - u.lean.value.x) * step,
        u.lean.value.y +
          (((height / 2 - pointer.y) / height - rest.y) * toward - u.lean.value.y) * step,
      );
      u.glow.value = GLOW_REST + GLOW_NEAR * near + (1 - GLOW_REST) * flare;
      const flash = kind === null ? REST : FLARES[kind];
      u.tint.value.set(
        REST[0] + (flash[0] - REST[0]) * flare,
        REST[1] + (flash[1] - REST[1]) * flare,
        REST[2] + (flash[2] - REST[2]) * flare,
      );
      const [dx, dy] = still ? [0, 0] : tremble(since, 1);
      u.centre.value.set(rest.x + dx * radius, rest.y + dy * radius);
      u.time.value = time;
      u.turn.value = turn;
      u.sway.value = SWING.angle * Math.sin((TAU * time) / SWING.period);
    },
    dispose: () => {
      clearTimeout(wake);
      chosen.dispose();
      relief.dispose();
    },
  };
}

export function mountWolfMedallion(
  host: HTMLElement,
  init: GpuBackdropInit,
): Promise<GpuBackdropScene> {
  return mountBackdrop(
    host,
    init,
    {
      bloom: { strength: 0.35, radius: 0.5 },
      lens: { aberration: 0.003, streak: 0, grain: 0.018 },
      // It fades into the page as a CSS mask would, so on a light page a strength's veil leaves the
      // steel its darks rather than greying it in linear light.
      fadeSpace: "display",
      // Smoke and embers dissolve by their own shapes; the frame's feather is only the last guard.
      feather: { sides: 0.03, top: 0.03, bottom: 0.03 },
    },
    wolfMedallion,
  );
}
