/**
 * The wolf medallion backdrop: kb's own steel wolf sigil over drifting
 * smoke and rising embers, a faint circle of five glyphs turning behind it,
 * each in its own colour (shader: `medallion-shader.ts`; the geometry:
 * `medallion.ts`). The art setting may replace the sigil, the glyphs or
 * both (`medallionArt`).
 *
 * The medallion senses the page. When something happens that the owner did
 * not do here (`Reactions.notice`: a change arriving from elsewhere, an
 * error, the sidebar's agent finishing a turn), its eyes flare in that
 * event's colour and it swings a little more on its chain, pushed. It
 * senses the page by light, never by moving toward anything: it hangs on
 * its chain and does only what a hanging pendant does, a small, slow,
 * damped sway the air keeps up (`swingOn`, `HANGING`). The pointer near it
 * wakes its eyes a little, and stirs the air about the embers, which drift
 * and swirl away from it and settle back (`AIR`); typing slows the smoke;
 * writes turn the circle a little faster for a while. Under reduced motion
 * nothing moves: no sway, no stirred embers, and its eyes light, still, and
 * go dark again a few seconds later (two still frames). The smoke rises
 * and the embers climb. Near it, smoke and embers dissolve within a reach about it; far
 * from it, banks of smoke, sparks and glyph haze cross the scroll region,
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
import { farField, glowAbout, type FieldReach } from "../gpu/dissolve";
import { variation } from "../scene/seed";
import { textScrim } from "../gpu/text-scrim";
import { OWN_ART, type BackdropGlyph } from "@kb/model";
import { loadBackdropArt } from "../gpu/art";
import { glyphAtlas, type GlyphAtlas, type GlyphPaint } from "../gpu/glyph-atlas";
import { RUNES, TURN_SECONDS, swingOn, type Swing } from "./medallion";
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
/** How far the smoke and embers spread about the disk before they have dissolved (radii): close about it, so they hug the subject. */
const REACH = { x: 2.7, y: 2.1 } as const;
/** How much of the reach the smoke fills whole: a subject in the open, so little, and it tapers out. */
const SOLID = 0.26;
/**
 * Where the far layers (banks of smoke, sparks, glyph haze) thin out
 * across the frame: over its outer heights at either side, and low in it.
 */
const FIELD: FieldReach = { sides: 0.9, low: [-0.4, 0.02] };
/**
 * How it turns a little about its chain as it swings, per rad/s of swing
 * (medallion units of the eyes' parallax): a hanging pendant twists as it
 * sways, which is all the depth its eyes show.
 */
const TWIST = 1.2;
/**
 * The air the pointer stirs about the embers: how far its gust reaches
 * (frame heights), how fast the gust follows the pointer and settles (1/s),
 * and the pointer's speed (px/s) at which it blows full.
 */
const AIR = { reach: 0.16, follow: 3, settle: 1.4, full: 900 } as const;
/** How far above the frame's top it hangs from (medallion units). */
const PIVOT_ABOVE = 0.4;
/** Under reduced motion: how long the eyes stay lit, still (ms). */
const HELD_MS = 3500;

/** The glyphs to draw: the art's, each in its own colour or, where it names none, the rune's in its place; or kb's runes. */
function paintOf(glyphs: readonly BackdropGlyph[] | null): readonly GlyphPaint[] {
  return (glyphs ?? RUNES).map((glyph, k) => ({
    shape: glyph.shape,
    color: glyph.color ?? RUNES[k % RUNES.length]?.color ?? "#ffffff",
  }));
}

/**
 * The art the medallion draws (`BackdropArt`, as the art setting's URL
 * names it): its relief, baked from kb's sigil or the art's image, and its
 * glyphs, kb's runes or the art's. `shown` hears where the relief's top lies
 * (the chain's bail). A part that will not load leaves the medallion's own:
 * a backdrop never fails a page.
 */
function medallionArt(relief: BakedRelief, glyphs: GlyphAtlas, shown: (bail: number) => void) {
  let art: string | null | undefined;
  let image: ReliefArt | null = null;
  const showRelief = (next: ReliefArt | null) => {
    image?.texture.dispose();
    image = next;
    relief.setArt(next);
    shown(next === null ? SIGIL_BAIL.y + SIGIL_BAIL.radius : next.top);
  };
  showRelief(null);
  const reliefFrom = async (url: string | null, chosen: string | null) => {
    if (url === null) {
      showRelief(null);
      return;
    }
    try {
      const loaded = await loadReliefArt(url);
      if (art === chosen) showRelief(loaded);
      else loaded.texture.dispose();
    } catch (error: unknown) {
      logWarn("backdrop art", error);
      if (art === chosen) showRelief(null);
    }
  };
  // Glyphs that will not draw leave the runes; runes that will not draw (no 2D canvas) leave the circle bare.
  const glyphsFrom = async (own: readonly BackdropGlyph[] | null) => {
    const drawn = await glyphs.set(paintOf(own)).then(
      () => true,
      (error: unknown) => {
        logWarn("backdrop art", error);
        return false;
      },
    );
    if (!drawn && own !== null) await glyphsFrom(null);
  };
  return {
    /** Settles once the art asked for is shown (or has failed, leaving the medallion's own). */
    choose: async (url: string | null): Promise<void> => {
      if (url === art) return;
      art = url;
      const parts = await loadBackdropArt(url).catch((error: unknown) => {
        logWarn("backdrop art", error);
        return OWN_ART;
      });
      if (art !== url) return;
      await Promise.all([reliefFrom(parts.image, url), glyphsFrom(parts.glyphs)]);
    },
    /** An image still loading is dropped when it lands. */
    dispose: () => {
      art = undefined;
      image?.texture.dispose();
      glyphs.dispose();
    },
  };
}

function wolfMedallion(stage: SceneStage, init: GpuBackdropInit): BackdropParts {
  const vary = variation(init.seed);
  const scrim = textScrim();
  const atlas = glyphAtlas();
  const u = medallionUniforms(farField(scrim, FIELD), atlas);
  const relief = bakedRelief(stage.renderer);
  const chosen = medallionArt(relief, atlas, (bail) => {
    u.bail.value = bail;
    stage.invalidate();
  });
  // The first frame shown is already the art asked for: never the sigil, then the image; never the runes, then the art's glyphs.
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
  let swing: Swing = { angle: 0, speed: 0 };
  const gust = { x: 0, y: 0, blow: 0 };
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
      u.reach.set(glowAbout(w / h, rest, { x: REACH.x * radius, y: REACH.y * radius }, SOLID));
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
        if (!still) swing = swingOn(swing, 0, time, 1);
        if (still) {
          // Lit now, and drawn dark again once the hold is up: the stage draws a still only when asked.
          heldUntil = performance.now() + HELD_MS;
          clearTimeout(wake);
          wake = setTimeout(() => stage.invalidate(), HELD_MS + 30);
        }
      }
      const flare = still ? (performance.now() < heldUntil ? 1 : 0) : reactions.startle;
      const pointer = reactions.pointer;
      // The pointer near the disk wakes its eyes a little.
      const off = Math.hypot(
        (pointer.x - width / 2) / height - rest.x,
        (height / 2 - pointer.y) / height - rest.y,
      );
      const near = pointer.near * Math.exp(-((off / (radius * 3)) ** 2));
      // The pointer stirs the air: a gust following it with a lag, blowing as it moves, settling after.
      const blowing = still ? 0 : pointer.near * Math.min(1, pointer.speed / AIR.full);
      const follow = Math.min(1, dt * AIR.follow);
      gust.x += ((pointer.x - width / 2) / height - gust.x) * follow;
      gust.y += ((height / 2 - pointer.y) / height - gust.y) * follow;
      gust.blow = Math.max(blowing, gust.blow * Math.exp(-dt * AIR.settle));
      u.air.value.set(gust.x, gust.y, still ? 0 : gust.blow, AIR.reach);
      u.glow.value = GLOW_REST + GLOW_NEAR * near + (1 - GLOW_REST) * flare;
      const flash = kind === null ? REST : FLARES[kind];
      u.tint.value.set(
        REST[0] + (flash[0] - REST[0]) * flare,
        REST[1] + (flash[1] - REST[1]) * flare,
        REST[2] + (flash[2] - REST[2]) * flare,
      );
      swing = still ? { angle: 0, speed: 0 } : swingOn(swing, dt, time, 0);
      u.centre.value.set(rest.x, rest.y);
      u.time.value = time;
      u.turn.value = turn;
      u.sway.value = swing.angle;
      u.twist.value = swing.speed * TWIST;
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
      // No aberration: steel is a sharp object, and a lens's fringe reads as a coloured edge on it.
      lens: { aberration: 0, streak: 0, grain: 0.018 },
      // It fades into the page as a CSS mask would, so on a light page a strength's veil leaves the
      // steel its darks rather than greying it in linear light.
      fadeSpace: "display",
      // Smoke and embers dissolve by their own shapes; the frame's feather is only the last guard.
      feather: { sides: 0.03, top: 0.03, bottom: 0.03 },
    },
    wolfMedallion,
  );
}
