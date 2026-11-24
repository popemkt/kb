import { describe, expect, it } from "vitest";
import {
  PRISM_RIBBON_CODE_KNOB,
  PRISM_RIBBON_HUE_KNOB,
  PRISM_RIBBON_PRISM_KNOB,
} from "@kb/backdrops";
import {
  CODE_BUFFER_LEN,
  MAX_POINTER_LEAN,
  PRISM_CODE_TEXT,
  STILL_FLOW,
  encodeCodeLine,
  prismRibbonTuning,
  prismRibbonVariation,
  ribbonFieldReach,
  stepPointerRig,
  stepWriteWave,
  type PointerRig,
  type WriteWave,
} from "./prism-ribbon";
import { computeSdfField } from "./sdf-font";

const REST_POINTER: PointerRig = { x: 0, y: 0, cursorX: 0, cursorY: 0, near: 0 };

function runPointerTrack(stepMs: number): PointerRig {
  let rig: PointerRig = REST_POINTER;
  const dt = stepMs / 1000;
  const steps = Math.round(0.4 / dt);
  for (let i = 0; i < steps; i++) {
    rig = stepPointerRig(rig, { x: 0.9, y: -0.6, near: 1 }, dt);
  }
  return rig;
}

describe("prism ribbon tuning and variation", () => {
  it("maps default knobs to neutral tuning and scales custom values", () => {
    expect(prismRibbonTuning({})).toEqual({ hue: 0, code: 1, prism: 1 });
    const tuned = prismRibbonTuning({
      [PRISM_RIBBON_HUE_KNOB.id]: 30,
      [PRISM_RIBBON_CODE_KNOB.id]: 0.5,
      [PRISM_RIBBON_PRISM_KNOB.id]: 1.25,
    });
    expect(tuned.hue).toBeCloseTo(Math.PI / 6, 5);
    expect(tuned.code).toBe(0.5);
    expect(tuned.prism).toBe(1.25);
  });

  it("holds the curated still under reduced motion and varies visibly across seeds", () => {
    const stillA = prismRibbonVariation(7, true);
    const stillB = prismRibbonVariation(42, true);
    expect(stillA.flowStart).toBe(STILL_FLOW);
    expect(stillB).toEqual(stillA);

    const a = prismRibbonVariation(11, false);
    const b = prismRibbonVariation(29, false);
    expect(a).toEqual(prismRibbonVariation(11, false));
    expect(a.flowStart).not.toBe(b.flowStart);
    expect(a.hue).not.toBe(b.hue);
  });

  it("keeps the ground dissolve reach bounded inside every frame aspect", () => {
    for (const aspect of [1.1, 2.5, 4.0, 7.0]) {
      const reach = ribbonFieldReach(aspect, { x: 0, y: 0, scale: 1 });
      expect(reach.rx).toBeLessThanOrEqual(aspect / 2);
      expect(reach.ry).toBeLessThanOrEqual(0.5);
      expect(reach.solid).toBeGreaterThan(0);
      expect(reach.solid).toBeLessThan(1);
    }
  });
});

describe("prism ribbon pointer rig", () => {
  it("produces the same eased trajectory at 8 ms and 33 ms frame steps within 2%", () => {
    const fast = runPointerTrack(8);
    const slow = runPointerTrack(33);
    expect(Math.abs(fast.x - slow.x) / Math.max(1e-4, Math.abs(fast.x))).toBeLessThan(0.02);
    expect(Math.abs(fast.y - slow.y) / Math.max(1e-4, Math.abs(fast.y))).toBeLessThan(0.02);
  });

  it("starts eased, stays bounded, and returns to rest within 3 s of pointer leave", () => {
    const first = stepPointerRig(REST_POINTER, { x: 10, y: -10, near: 1 }, 1 / 60);
    expect(Math.abs(first.x)).toBeLessThan(MAX_POINTER_LEAN * 0.2);

    let rig: PointerRig = REST_POINTER;
    for (let i = 0; i < 180; i++) {
      rig = stepPointerRig(rig, { x: 5, y: 5, near: 1 }, 1 / 60);
    }
    expect(Math.abs(rig.x)).toBeLessThanOrEqual(MAX_POINTER_LEAN + 1e-6);
    expect(Math.abs(rig.y)).toBeLessThanOrEqual(MAX_POINTER_LEAN + 1e-6);

    for (let i = 0; i < 180; i++) {
      rig = stepPointerRig(rig, { x: 0, y: 0, near: 0 }, 1 / 60);
    }
    expect(Math.abs(rig.x)).toBeLessThan(0.002);
    expect(Math.abs(rig.y)).toBeLessThan(0.002);
  });
});

describe("prism ribbon write wave", () => {
  it("sweeps forward across the spine on a write and settles cleanly to rest", () => {
    let wave: WriteWave = { x: -2.2, energy: 0, armed: true };
    wave = stepWriteWave(wave, 0.9, 1 / 60);
    expect(wave.energy).toBeGreaterThan(0.05);
    const startX = wave.x;
    for (let i = 0; i < 60; i++) {
      wave = stepWriteWave(wave, Math.max(0, 0.8 - i * 0.02), 1 / 60);
    }
    expect(wave.x).toBeGreaterThan(startX + 1.5);
    for (let i = 0; i < 180; i++) {
      wave = stepWriteWave(wave, 0, 1 / 60);
    }
    expect(wave.energy).toBe(0);
    expect(wave.armed).toBe(true);
  });
});

describe("prism ribbon SDF font and code buffer", () => {
  it("encodes the iconic raymarch shader line cleanly into a 256-texel buffer", () => {
    const encoded = encodeCodeLine(PRISM_CODE_TEXT);
    expect(encoded.data.length).toBe(CODE_BUFFER_LEN * 4);
    expect(encoded.length).toBe(PRISM_CODE_TEXT.length);
    expect(encoded.data[0]).toBe("f".charCodeAt(0));
    expect(encoded.data[encoded.length * 4]).toBe(0);
  });

  it("computes a signed distance field > 0.5 inside shapes and < 0.5 outside", () => {
    const size = 16;
    const mask = new Float32Array(size * size);
    for (let y = 5; y <= 10; y++) {
      for (let x = 5; x <= 10; x++) mask[y * size + x] = 1;
    }
    const sdf = computeSdfField(mask, size, size, 4);
    const center = sdf[(8 * size + 8) * 4] ?? 0;
    const corner = sdf[0] ?? 0;
    expect(center).toBeGreaterThan(180);
    expect(corner).toBeLessThan(80);
  });
});
