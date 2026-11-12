/**
 * The stage: the one thing every animated 2D backdrop shares that is not a
 * picture. It owns the canvas (sized to its frame, drawn at the display's
 * pixel ratio), the clock (time-based: the same seconds pass at 60 or 120 Hz,
 * and a long stall is clamped, never leapt), the pause (`watchPlayback`), the
 * pointer over its own frame, the owner's reactions, and a frame-cost meter
 * that lowers detail before a busy page feels the scene. It knows nothing of
 * bats, and a composition (`composition.ts`) knows nothing of the clock.
 */
import { meterFrames } from "@kb/appearance-kit";
import type { BackdropBudget, PointerSource } from "@kb/ui-sdk";
import { watchPlayback } from "../playback.ts";
import type { Composition, SceneConfig } from "./composition.ts";
import { clamp } from "./math.ts";
import { sceneClock } from "./clock.ts";
import { sameLook, type Look } from "./look.ts";
import { startReactions, type Reactions } from "./reactions.ts";

export interface Stage {
  readonly reactions: Reactions;
  /** What the page says now (`look.ts`): laid out again only where it differs from the look drawn. */
  readonly look: (look: Look) => void;
  /** The owner's speed (the speed knob): the picture's time scaled, the reactions' kept. */
  readonly setSpeed: (speed: number) => void;
  readonly dispose: () => void;
}

export interface StageOptions {
  readonly reducedMotion: boolean;
  /** The pointer over the frame, as the page head declares it (`BackdropProps.pointer`). */
  readonly pointer: PointerSource;
  /** What a frame may spend (`Backdrop.budget`), which the stage's frame meter holds it to. */
  readonly budget: BackdropBudget;
}

/** The longest stretch of time one step may take; a stalled tab resumes smoothly, not in a leap. */
const MAX_DT = 1 / 20;
const MAX_DPR = 2;

export function createStage(
  canvas: HTMLCanvasElement,
  composition: Composition,
  options: StageOptions,
): Stage {
  const reactions = startReactions();
  const context = canvas.getContext("2d");
  const meter = meterFrames(canvas, options.budget);
  const clock = sceneClock();
  let current: Look | null = null;
  let width = 0;
  let height = 0;
  let last = 0;
  let disposed = false;
  let running = false;
  let raf = 0;

  const dprNow = () =>
    Math.min(window.devicePixelRatio || 1, MAX_DPR) * (meter.quality() < 0.7 ? 0.8 : 1);

  const paint = () => {
    if (context === null) return;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.globalAlpha = 1;
    composition.draw(context);
  };

  const configure = () => {
    if (current === null || width < 2 || height < 2) return;
    const dpr = dprNow();
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const config: SceneConfig = { width, height, dpr, quality: meter.quality(), ...current };
    composition.configure(config);
    if (options.reducedMotion) composition.settle(reactions);
    if (options.reducedMotion || !running) paint();
  };

  /** The pointer's place over this frame now, told to the reactions. */
  const feedPointer = () => {
    const at = options.pointer.now();
    if (at === null) reactions.clearPointer();
    else reactions.setPointer(at.x, at.y);
  };

  const tick = (now: number) => {
    raf = 0;
    if (!running || disposed) return;
    const dt = clamp((now - last) / 1000, 0, MAX_DT);
    last = now;
    const began = performance.now();
    feedPointer();
    reactions.update(dt);
    composition.step(clock.advance(dt), reactions);
    paint();
    // Lower detail while frames run over budget: the cost is the stage's to hold, not the page's to pay.
    if (meter.record(performance.now() - began)) configure();
    raf = requestAnimationFrame(tick);
  };

  const play = (playing: boolean) => {
    running = playing && !options.reducedMotion;
    if (running && raf === 0) {
      last = performance.now();
      raf = requestAnimationFrame(tick);
    } else if (!running && raf !== 0) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
    canvas.dataset.sceneState = running ? "playing" : options.reducedMotion ? "still" : "paused";
  };

  const observer = new ResizeObserver(([entry]) => {
    if (entry === undefined) return;
    width = entry.contentRect.width;
    height = entry.contentRect.height;
    configure();
  });
  observer.observe(canvas);
  const watch = watchPlayback(canvas, options.reducedMotion, play);
  play(watch.playing());

  return {
    reactions,
    look: (look) => {
      if (sameLook(current, look)) return;
      current = look;
      configure();
    },
    setSpeed: clock.setSpeed,
    dispose: () => {
      disposed = true;
      if (raf !== 0) cancelAnimationFrame(raf);
      observer.disconnect();
      watch.dispose();
    },
  };
}
