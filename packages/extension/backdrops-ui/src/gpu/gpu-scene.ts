/**
 * `mountBackdrop`: the one way a GPU backdrop becomes a scene (DESIGN-UI.md
 * → Page-head backdrops → GPU scenes), on the scene kit's stage
 * (`mountScene`, Lab principle P4) as the lab's studies are.
 *
 * A backdrop supplies what is its own: its shader, what a frame does, its two
 * compositions (`framing.ts`) and how it spends quality. What every one of
 * them shares is here, once:
 *
 * - **The page's frame.** The shoulder tone curve and a side feather, so the
 *   ground meets the page around the frame to the level; the lens (a little
 *   aberration, a streak, grain); presence, the strength's opacity times the
 *   composition's, as how far the scene rises out of its ground.
 * - **The owner.** The declared pointer, polled each frame, and the activity
 *   (typing, a write, a move to another page) as the 2D scenes' eased
 *   signals (`../scene/reactions`). Input is an impulse into a running
 *   scene, never a restart: a backdrop reads `reactions.impulse` (every
 *   write, keystrokes gently, merged and throttled) or `reactions.stir` (the
 *   same without typing's share) in its frame. A scene is mounted once for
 *   its head: its clock (`clock`) only moves forward.
 * - **Its cost.** The frame-cost meter (`../scene/meter`) over the GPU's own
 *   time where the backend reports it (`gpuMs`), else over the frame
 *   interval; over budget, quality steps down and the backdrop spends less.
 *   The canvas carries what it measured (`data-gpu-ms`, `data-quality`) and
 *   its clock (`data-clock`).
 *
 * This module imports three (through `@kb/scene-gpu`), so only the GPU
 * host's own lazy import reaches it (`gpu-backdrop.tsx`).
 */
import type { BackdropDirection } from "@kb/model";
import type { SceneHandle, ScenePalette } from "@kb/scene";
import { mountScene, type SceneStage, type StageOptions, type TslNode } from "@kb/scene-gpu";
import type { PointerSource, Timing } from "@kb/ui-sdk";
import { meterOf } from "../scene/meter";
import { startReactions, type PageEventKind, type Reactions } from "../scene/reactions";
import { anchorIn, framingAt, type Anchor, type Composition, type ContentBox } from "./framing";

/** What the page says about how a backdrop paints. */
export interface GpuLook {
  readonly palette: ScenePalette;
  readonly dark: boolean;
  /** The head's opacity at the chosen strength. */
  readonly presence: number;
  readonly direction: BackdropDirection;
}

export interface GpuBackdropInit extends GpuLook {
  readonly reducedMotion: boolean;
  readonly timing: Timing;
  /** This mount's seed; a still (reduced motion) is always the same curated one. */
  readonly seed: number;
  readonly pointer: PointerSource;
  /** Where the head's content lies across the frame as it mounts. */
  readonly content: ContentBox;
}

/** A mounted GPU backdrop, as its React host drives it. */
export interface GpuBackdropScene extends SceneHandle {
  readonly setLook: (look: GpuLook) => void;
  /** A write landed (a keystroke while editing): an impulse, merged into the one under way. */
  readonly write: () => void;
  readonly navigate: () => void;
  /** Something happened on the page (`Reactions.notice`). */
  readonly notice: (kind: PageEventKind) => void;
  readonly setEditing: (editing: boolean) => void;
  /** The head's content moved across the frame (the content width changed): the hero follows it. */
  readonly setContent: (content: ContentBox) => void;
  /** Seconds the scene has run since it mounted: it never goes back. */
  readonly clock: () => number;
}

export type GpuBackdropMount = (
  host: HTMLElement,
  init: GpuBackdropInit,
) => Promise<GpuBackdropScene>;

/**
 * The page's ground as a backdrop's shader paints with it. A dark page's
 * scene is light over `ground`, and the curve rolls its highlights off; a
 * light page's picture is composed in the page's own terms (`page` times a
 * shade) and goes through `paint`, or the curve washes it to white.
 */
export interface Grounds {
  readonly ground: TslNode<"vec3">;
  readonly page: TslNode<"vec3">;
  readonly paint: (shown: TslNode<"vec3">) => TslNode<"vec3">;
}

export const groundsOf = (stage: SceneStage): Grounds => ({
  ground: stage.ground,
  page: stage.colors.ground,
  paint: stage.paint,
});

/** The frame as a backdrop lays itself out in it. */
export interface BackdropLayout {
  /** CSS pixels. */
  readonly width: number;
  readonly height: number;
  /** 1 at full detail, down to `MIN_QUALITY` while frames run over budget. */
  readonly quality: number;
  /** Where the hero stands, from the composition for this width and the content (`framing.ts`). */
  readonly anchor: Anchor;
  /** Where the head's content lies, CSS pixels from the frame's left: its text is there. */
  readonly content: ContentBox;
}

export interface BackdropParts {
  /** Its panel and its wide composition (`framing.ts`). */
  readonly panel: Composition;
  readonly wide: Composition;
  /** Advance by `dt` seconds (0 under reduced motion) and draw what it draws offscreen. */
  readonly frame: (dt: number, reactions: Reactions) => void;
  /**
   * Lay out for a new size or quality, and say where the hero was drawn, in
   * frame units (`Anchor`): from its anchor, and moved or made smaller only
   * where the frame obliged. Null for a field with no one hero.
   */
  readonly layout: (layout: BackdropLayout) => Anchor | null;
  readonly setLook: (look: GpuLook) => void;
  /** Release what the stage's scene traversal does not reach. */
  readonly dispose: () => void;
}

/** The stage a backdrop asks for beyond the kit's shared frame. */
/**
 * A backdrop's stage: its bloom and lens, and how its frame fades into the
 * page: a painted, high-key scene fades as a CSS mask would (`fadeSpace`),
 * and one whose subject reaches low in the frame (a sea under its horizon)
 * may fade later than the frame's own (`FRAME_FEATHER`).
 */
export type BackdropStageOptions = Pick<StageOptions, "bloom" | "lens" | "fadeSpace" | "feather">;

/** How the frame's sides, top and bottom fade into the page's ground (shares of the frame). */
const FRAME_FEATHER = { sides: 0.12, top: 0.08, bottom: 0.5 } as const;

/** GPU time a backdrop may take per frame (ms): a third of a 60 Hz frame, the rest is the page's. */
const GPU_BUDGET_MS = 6;
/** Without GPU time, a frame interval past this (ms) means the page is paying. */
const INTERVAL_BUDGET_MS = 1000 / 48;
const MIN_QUALITY = 0.4;
const QUALITY_STEP = 0.15;

export async function mountBackdrop(
  host: HTMLElement,
  init: GpuBackdropInit,
  options: BackdropStageOptions,
  build: (stage: SceneStage, init: GpuBackdropInit) => BackdropParts,
): Promise<GpuBackdropScene> {
  const reactions = startReactions();
  const gpuMeter = meterOf(GPU_BUDGET_MS);
  const intervalMeter = meterOf(INTERVAL_BUDGET_MS);
  let look: GpuLook = init;
  let width = 0;
  let height = 0;
  let content = init.content;
  let quality = 1;
  let elapsed = 0;

  const { stage, parts, handle } = await mountScene(
    host,
    {
      ...options,
      fov: 40,
      palette: init.palette,
      timing: init.timing,
      reducedMotion: init.reducedMotion,
      toneMapping: "shoulder",
      // GAP [[01M5STYVFCKQ7TZ8XBSGSRHRH9]] an opaque frame feathered to the flat ground, no alpha mode
      feather: options.feather ?? FRAME_FEATHER,
      gpuTiming: true,
    },
    (on) => {
      const backdrop = build(on, init);
      // Its first frame is already the page's look.
      backdrop.setLook(init);
      const canvas = on.renderer.domElement;
      canvas.dataset.backend = on.backend;
      const relayout = () => {
        if (width < 2 || height < 2) return;
        const composition = framingAt(width, backdrop.panel, backdrop.wide);
        on.setPresence(look.presence * composition.presence);
        const anchor = anchorIn(composition, { width, height }, content);
        const hero = backdrop.layout({ width, height, quality, anchor, content });
        canvas.dataset.quality = quality.toFixed(2);
        // What a spec reads to see the hero hold its place and size whatever the width: heights
        // right of the content's centre, heights up from the frame's middle, and its scale.
        const centre = (content.left + content.width / 2 - width / 2) / height;
        if (hero === null) delete canvas.dataset.hero;
        else
          canvas.dataset.hero = [hero.x - centre, hero.y, hero.scale]
            .map((v) => v.toFixed(3))
            .join(" ");
      };
      const measure = (dt: number) => {
        const gpu = on.gpuMs();
        const verdict = gpu === null ? intervalMeter.record(dt * 1000) : gpuMeter.record(gpu);
        if (verdict === null) return;
        if (gpu !== null) canvas.dataset.gpuMs = verdict.spent.toFixed(2);
        // Lower detail while frames run over budget: the scene's cost to hold, not the page's to pay.
        if (verdict.lower && quality > MIN_QUALITY) {
          quality = Math.max(MIN_QUALITY, quality - QUALITY_STEP);
          relayout();
        }
      };
      return {
        backdrop,
        relayout,
        frame: (dt: number) => {
          const at = init.pointer.now();
          if (at === null) reactions.clearPointer();
          else reactions.setPointer(at.x, at.y);
          reactions.update(dt);
          elapsed += dt;
          // What a spec reads to see the scene carry on (`clock`), never start over.
          canvas.dataset.clock = elapsed.toFixed(3);
          backdrop.frame(dt, reactions);
          if (dt > 0) measure(dt);
          return true;
        },
        resize: (w: number, h: number) => {
          width = w;
          height = h;
          relayout();
        },
        dispose: backdrop.dispose,
      };
    },
  );
  const { backdrop, relayout } = parts;
  const setLook = (next: GpuLook) => {
    look = next;
    stage.setPalette(next.palette);
    backdrop.setLook(next);
    relayout();
  };

  return {
    ...handle,
    setLook,
    write: () => {
      reactions.write();
      stage.invalidate();
    },
    navigate: () => {
      reactions.navigate();
      stage.invalidate();
    },
    notice: (kind) => {
      reactions.notice(kind);
      stage.invalidate();
    },
    setEditing: (next) => {
      reactions.setEditing(next);
      stage.invalidate();
    },
    setContent: (next) => {
      content = next;
      relayout();
      stage.invalidate();
    },
    clock: () => elapsed,
  };
}
