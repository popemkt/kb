/**
 * The frame meter (DESIGN-UI.md → Page-head backdrops → The surface): what
 * a backdrop's frames cost against its budget (`Backdrop.budget`), and the
 * detail it draws at. Over budget for long enough, its quality steps down,
 * so the scene pays for a busy page and the page does not pay for the
 * scene. Every metered backdrop holds its cost with it, kb's own 2D stage
 * and GPU host and a plugin's scene alike, so "within budget" means one
 * thing whoever drew the frame.
 *
 * It reports on the canvas it meters, the one place a reader finds it
 * (`readFrameMeter`, Backdrop Studio's perf readout): `data-quality` and
 * its floor (`data-quality-floor`), and the smoothed cost as
 * `data-frame-ms` (the main thread's) or `data-gpu-ms` (the GPU's).
 */
import type { BackdropBudget } from "./plugins";

/**
 * What one recorded cost measures: the main thread's time drawing the
 * frame (`frame`) or the GPU's (`gpu`), each against the budget; or, for a
 * GPU scene whose backend reports no GPU time, the interval since the last
 * frame (`interval`), against a frame at 48 Hz, past which the page is
 * paying.
 */
export type FrameCost = "frame" | "gpu" | "interval";

export interface FrameMeter {
  /** 1 at full detail, down to the meter's floor while frames run over budget. */
  readonly quality: () => number;
  /**
   * Record one frame's cost in ms, measured as `cost` says (`frame` unless
   * it says): true when quality just stepped down, so the scene lays itself
   * out again at the new quality.
   */
  readonly record: (ms: number, cost?: FrameCost) => boolean;
}

export interface FrameMeterOptions {
  /** The lowest quality it steps down to (by default 0.45). */
  readonly floor?: number;
}

/** A frame interval past this (ms) means the page is paying (`interval`). */
const INTERVAL_BUDGET_MS = 1000 / 48;
const QUALITY_STEP = 0.15;
const DEFAULT_FLOOR = 0.45;
/** Frames between verdicts, and verdicts over budget in a row before quality steps down. */
const VERDICT_FRAMES = 30;
const VERDICTS_OVER = 3;

/** The canvas attribute each cost is reported under; an interval is no cost of the scene's and is not. */
const REPORTED: Readonly<Record<FrameCost, "frameMs" | "gpuMs" | null>> = {
  frame: "frameMs",
  gpu: "gpuMs",
  interval: null,
};

/**
 * A smoothed cost per frame (ms), and a verdict every 30 frames on whether
 * it has run over budget long enough to lower detail.
 */
function smoothed(budgetMs: number) {
  let spent = 0;
  let frames = 0;
  let over = 0;
  return (ms: number): { spent: number; lower: boolean } | null => {
    spent = spent === 0 ? ms : spent * 0.94 + ms * 0.06;
    frames++;
    if (frames % VERDICT_FRAMES !== 0) return null;
    over = spent > budgetMs ? over + 1 : 0;
    const lower = over >= VERDICTS_OVER;
    if (lower) over = 0;
    return { spent, lower };
  };
}

/** Meter `canvas`'s frames against `budget`, starting at full quality. */
export function meterFrames(
  canvas: HTMLCanvasElement,
  budget: BackdropBudget,
  options: FrameMeterOptions = {},
): FrameMeter {
  const floor = options.floor ?? DEFAULT_FLOOR;
  const meters = new Map<FrameCost, ReturnType<typeof smoothed>>();
  let quality = 1;
  canvas.dataset.quality = quality.toFixed(2);
  canvas.dataset.qualityFloor = floor.toFixed(2);
  return {
    quality: () => quality,
    record: (ms, cost = "frame") => {
      let meter = meters.get(cost);
      if (meter === undefined) {
        meter = smoothed(cost === "interval" ? INTERVAL_BUDGET_MS : budget.frameMs);
        meters.set(cost, meter);
      }
      const verdict = meter(ms);
      if (verdict === null) return false;
      const reported = REPORTED[cost];
      if (reported !== null) canvas.dataset[reported] = verdict.spent.toFixed(2);
      if (!verdict.lower || quality <= floor) return false;
      quality = Math.max(floor, quality - QUALITY_STEP);
      canvas.dataset.quality = quality.toFixed(2);
      return true;
    },
  };
}

/** What a frame meter last reported on a canvas in `frame`. */
export interface FrameMeterReading {
  /** The backend that draws it, where its host says (`data-backend`). */
  readonly backend: string | null;
  /** Milliseconds a frame spent, as the meter last reported; null, not reported yet. */
  readonly spent: number | null;
  readonly quality: number | null;
  /** The lowest quality it steps down to: at it, the meter has nothing left to lower. */
  readonly floor: number | null;
  /** Whether a frame meter meters a canvas in `frame` at all. */
  readonly metered: boolean;
}

const UNMETERED: FrameMeterReading = {
  backend: null,
  spent: null,
  quality: null,
  floor: null,
  metered: false,
};

const numberOf = (value: string | undefined): number | null => {
  const n = value === undefined ? Number.NaN : Number(value);
  return Number.isFinite(n) ? n : null;
};

/** What the frame meter of the metered canvas in `frame` last reported: its GPU time where it has one. */
export function readFrameMeter(frame: HTMLElement | null): FrameMeterReading {
  const canvas = frame?.querySelector<HTMLCanvasElement>("canvas[data-quality]");
  if (canvas === null || canvas === undefined) return UNMETERED;
  const { backend, gpuMs, frameMs, quality, qualityFloor } = canvas.dataset;
  return {
    backend: backend ?? null,
    spent: numberOf(gpuMs ?? frameMs),
    quality: numberOf(quality),
    floor: numberOf(qualityFloor),
    metered: true,
  };
}
