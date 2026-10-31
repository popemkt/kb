import { describe, expect, it } from "vitest";
import { startReactions } from "../scene/reactions";
import { variation } from "../scene/seed";
import { flareOrbit, holeDensity, holeDolly, type HoleView } from "./hole-rig";

const FRAME = { width: 1280, height: 360 };
const REST: HoleView = { inclination: 0.085, azimuth: 0 };
/** The scripted pointer track: enter at 0.5 s, sweep, rest, leave at 3 s. */
const ENTER = 0.5;
const LEAVE = 3;

function pointerAt(t: number): { x: number; y: number } | null {
  if (t < ENTER || t >= LEAVE) return null;
  const sweep = Math.min(1, (t - ENTER) / 1.5);
  return { x: 400 + 700 * sweep, y: 60 + 120 * sweep };
}

/** The sample at `t` seconds of a run sampled each tenth of a second. */
function at(samples: readonly HoleView[], t: number): HoleView {
  const view = samples[Math.round(t / 0.1)];
  if (view === undefined) throw new Error(`no sample at ${t} s`);
  return view;
}

/** The dolly run on the track to `until` in frames of `dt`, sampled each tenth of a second. */
function run(dt: number, until: number, track = pointerAt) {
  const dolly = holeDolly(REST);
  const reactions = startReactions();
  const samples: HoleView[] = [];
  let next = 0;
  for (let t = 0; t <= until + 1e-9; t += dt) {
    const point = track(t);
    if (point === null) reactions.clearPointer();
    else reactions.setPointer(point.x, point.y);
    reactions.update(dt);
    const view = dolly.follow(dt, reactions, FRAME);
    if (t >= next - 1e-9) {
      samples.push(view);
      next += 0.1;
    }
  }
  return samples;
}

describe("the hole's dolly", () => {
  it("takes the same path at a frame step of 8 ms and of 33 ms", () => {
    const fine = run(0.008, 7);
    const coarse = run(1 / 30, 7);
    const span = Math.max(...fine.map((v) => v.inclination)) - REST.inclination;
    for (let t = 0; t <= 7; t += 0.1) {
      const [one, other] = [at(fine, t), at(coarse, t)];
      expect(Math.abs(one.inclination - other.inclination)).toBeLessThan(0.02 * span + 2e-3);
      expect(Math.abs(one.azimuth - other.azimuth)).toBeLessThan(0.02 * 0.3 + 2e-3);
    }
  });

  it("starts eased, stays bounded and is at rest within 3 s of the pointer leaving", () => {
    const dt = 1 / 60;
    const views = run(dt, LEAVE + 3);
    const still = run(dt, LEAVE + 3, () => null);
    const reach = Math.abs(at(views, LEAVE - 0.1).inclination - at(still, LEAVE - 0.1).inclination);
    // The first frame the pointer is over the frame: a step from where the dolly was.
    const dolly = holeDolly(REST);
    const reactions = startReactions();
    let before = REST;
    for (let t = 0; t < ENTER; t += dt) before = dolly.follow(dt, reactions, FRAME);
    reactions.setPointer(400, 60);
    reactions.update(dt);
    const first = dolly.follow(dt, reactions, FRAME);
    expect(Math.abs(first.inclination - before.inclination)).toBeLessThan(0.2 * reach);
    for (const view of views) {
      expect(view.inclination).toBeGreaterThan(0.05);
      expect(view.inclination).toBeLessThan(0.23);
      expect(Math.abs(view.azimuth)).toBeLessThan(0.31);
    }
    const settled = at(views, LEAVE + 3);
    const resting = at(still, LEAVE + 3);
    expect(Math.abs(settled.inclination - resting.inclination)).toBeLessThan(0.02 * reach);
    expect(Math.abs(settled.azimuth - resting.azimuth)).toBeLessThan(0.01);
  });
});

describe("the flare's orbit", () => {
  it("starts somewhere new from dark and keeps its place while a write brightens it", () => {
    const flare = flareOrbit(variation(7));
    const stir = (level: number) => ({ stir: level }) as Parameters<typeof flare.follow>[0];
    const first = flare.follow(stir(0.5));
    expect(flare.follow(stir(0.8)).phase).toBe(first.phase);
    flare.follow(stir(0));
    expect(flare.follow(stir(0.5)).phase).not.toBe(first.phase);
  });
});

describe("the hole's density", () => {
  it("is its top at full quality, never under one, and capped at the screen's", () => {
    globalThis.devicePixelRatio = 2;
    expect(holeDensity(1, 2)).toBe(2);
    expect(holeDensity(1, 1.5)).toBe(1.5);
    expect(holeDensity(0.4, 2)).toBe(1);
    globalThis.devicePixelRatio = 1;
    expect(holeDensity(1, 2)).toBe(1);
  });
});
