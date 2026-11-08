// @vitest-environment happy-dom
/**
 * The frame meter (DESIGN-UI.md → Page-head backdrops → The surface): a
 * backdrop's frames held to its budget. A verdict lands every 30 frames;
 * three over budget in a row step quality down by 0.15, never past the
 * floor; the canvas carries what it measured, which the studio reads.
 */
import { describe, expect, test } from "vitest";
import { meterFrames, readFrameMeter, type FrameCost } from "./frame-meter";

const BUDGET = { frameMs: 2 };

function metered() {
  const frame = document.createElement("div");
  const canvas = document.createElement("canvas");
  frame.append(canvas);
  return { frame, canvas };
}

/** Record `frames` frames of `ms` each; how many of them stepped quality down. */
function run(
  meter: ReturnType<typeof meterFrames>,
  frames: number,
  ms: number,
  cost?: FrameCost,
): number {
  let lowered = 0;
  for (let i = 0; i < frames; i++) if (meter.record(ms, cost)) lowered++;
  return lowered;
}

describe("the frame meter", () => {
  test("starts at full quality and says so on its canvas", () => {
    const { frame, canvas } = metered();
    const meter = meterFrames(canvas, BUDGET);
    expect(meter.quality()).toBe(1);
    expect(readFrameMeter(frame)).toEqual({
      backend: null,
      spent: null,
      quality: 1,
      metered: true,
    });
  });

  test("within budget, it reports the cost and keeps its quality", () => {
    const { frame, canvas } = metered();
    const meter = meterFrames(canvas, BUDGET);
    expect(run(meter, 300, 1)).toBe(0);
    expect(meter.quality()).toBe(1);
    expect(readFrameMeter(frame).spent).toBe(1);
  });

  test("over budget for three verdicts, it steps down once, and again after three more", () => {
    const { frame, canvas } = metered();
    const meter = meterFrames(canvas, BUDGET);
    expect(run(meter, 89, 5)).toBe(0);
    expect(run(meter, 1, 5)).toBe(1);
    expect(meter.quality()).toBeCloseTo(0.85);
    expect(readFrameMeter(frame).quality).toBe(0.85);
    expect(run(meter, 90, 5)).toBe(1);
    expect(meter.quality()).toBeCloseTo(0.7);
  });

  test("never steps below its floor", () => {
    const { canvas } = metered();
    const meter = meterFrames(canvas, BUDGET, { floor: 0.4 });
    run(meter, 3000, 9);
    expect(meter.quality()).toBe(0.4);
    expect(run(meter, 300, 9)).toBe(0);
  });

  test("reports GPU time over the main thread's, and an interval not at all", () => {
    const { frame, canvas } = metered();
    canvas.dataset.backend = "webgpu";
    const meter = meterFrames(canvas, BUDGET);
    run(meter, 30, 1, "interval");
    expect(readFrameMeter(frame).spent).toBeNull();
    run(meter, 30, 1.5, "gpu");
    expect(readFrameMeter(frame)).toMatchObject({ backend: "webgpu", spent: 1.5 });
  });

  test("holds an interval to a frame at 48 Hz, not to the budget", () => {
    const { canvas } = metered();
    const meter = meterFrames(canvas, BUDGET);
    expect(run(meter, 300, 16, "interval")).toBe(0);
    expect(run(meter, 90, 30, "interval")).toBe(1);
  });

  test("a frame no meter meters reads as unmetered", () => {
    const frame = document.createElement("div");
    frame.append(document.createElement("canvas"));
    expect(readFrameMeter(frame).metered).toBe(false);
    expect(readFrameMeter(null).metered).toBe(false);
  });
});
