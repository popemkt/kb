import { describe, expect, it } from "vitest";
import { TAU } from "../scene/math";
import { variation } from "../scene/seed";
import {
  AMBIENT,
  ASTRAL_VARIANTS,
  CONSTELLATION_LINKS,
  CONSTELLATION_POINTS,
  STEP_SECONDS,
  TICK_PERIOD,
  ambient,
  gleamAt,
  meshed,
  tickEase,
  trainClock,
  walk,
  type AmbientKind,
} from "./astral";
import { compose } from "./compositions";

/** A train run from `start` to `until` in frames of `dt`: where a wheel on every `every`th tick stands. */
function run(start: number, dt: number, until: number, every = 1) {
  const clock = trainClock(TICK_PERIOD, start);
  for (let t = start; t <= until; t += dt) clock.advance(t);
  clock.advance(until);
  return clock.position(every);
}

/** Where on its tooth pitch a wheel turned to `spin` stands at `angle` (0–1). */
const phaseAt = (spin: number, teeth: number, angle: number) =>
  ((((angle - spin) / (TAU / teeth)) % 1) + 1) % 1;

/** The sky's events over ten minutes for `seed`. */
function eventsOf(seed: number) {
  const sky = ambient(variation(seed).stream, 0);
  const out: string[] = [];
  for (let t = 0; t < 600; t += 0.5) {
    for (const h of Object.values(sky.at(t))) out.push(`${h.kind}@${h.at.toFixed(3)}`);
  }
  return out;
}

describe("tickEase", () => {
  it("starts at rest, overshoots, recoils short of the notch, and settles on it", () => {
    expect(tickEase(0)).toBe(0);
    expect(tickEase(1)).toBe(1);
    expect(tickEase(2)).toBe(1);
    const samples = Array.from({ length: 101 }, (_, i) => tickEase(i / 100));
    expect(Math.max(...samples)).toBeGreaterThan(1);
    expect(Math.max(...samples)).toBeLessThan(1.1);
    expect(Math.min(...samples.slice(60))).toBeLessThan(1);
    // Continuous: no sample jumps by more than a tenth of a step.
    for (let i = 1; i < samples.length; i++) {
      expect(Math.abs((samples[i] ?? 0) - (samples[i - 1] ?? 0))).toBeLessThan(0.1);
    }
  });
});

describe("trainClock", () => {
  it("stands where it would whatever the frame rate", () => {
    for (const until of [7.1, 10.15, 31.3]) {
      const at60 = run(0.5, 1 / 60, until);
      expect(run(0.5, 1 / 144, until)).toBeCloseTo(at60, 6);
      expect(run(0.5, 1 / 24, until)).toBeCloseTo(at60, 6);
      expect(run(0.5, 0.9, until)).toBeCloseTo(at60, 6);
    }
  });

  it("ticks once a period, and a wheel on every fourth tick jumps a quarter as often", () => {
    const settled = 40 * TICK_PERIOD + STEP_SECONDS + 0.01;
    expect(run(0, 0.1, settled)).toBe(40);
    expect(run(0, 0.1, settled, 4)).toBe(10);
  });

  it("an event advances one notch at once, eased, and it settles within the step", () => {
    const clock = trainClock(TICK_PERIOD, 0.5);
    clock.advance(1);
    const before = clock.position(1);
    clock.notch();
    clock.advance(1 + STEP_SECONDS / 4);
    expect(clock.position(1)).toBeGreaterThan(before);
    clock.advance(1 + STEP_SECONDS + 0.01);
    expect(clock.position(1)).toBe(before + 1);
    expect(clock.ticks()).toBe(1);
  });

  it("never goes back", () => {
    const clock = trainClock(TICK_PERIOD, 0);
    clock.advance(9);
    const at = clock.position(1);
    clock.advance(3);
    expect(clock.position(1)).toBe(at);
  });
});

describe("meshed", () => {
  it("touches pitch circles, and turns opposite by the teeth", () => {
    const a = { at: [0.2, -0.1, 0.3] as const, radius: 1, teeth: 60, spin: 0.4 };
    const b = meshed(a, 0.5, { radius: 0.4, teeth: 24 }, 1.1);
    expect(Math.hypot(b.at[0] - a.at[0], b.at[1] - a.at[1])).toBeCloseTo(1.4, 9);
    expect(b.at[2]).toBe(0.3);
    expect(b.ratio).toBeCloseTo((-0.5 * 60) / 24, 9);
  });

  it("keeps the teeth meshed as both turn: the same tooth phase at the contact, step after step", () => {
    const a = { at: [0, 0, 0] as const, radius: 1, teeth: 60, spin: 0.25 };
    const b = meshed(a, 1, { radius: 0.5, teeth: 30 }, 0.7);
    for (const turned of [0, 1, 7, 13]) {
      const aSpin = a.spin + turned * (TAU / 60);
      const bSpin = b.spin + turned * b.ratio * (TAU / 60);
      // A tooth's centre is half a pitch in, a gap's is at 0: a's tooth faces b's gap, so they sum to half a tooth.
      const sum = phaseAt(aSpin, 60, 0.7) + phaseAt(bSpin, 30, 0.7 + Math.PI);
      expect((((sum - 0.5) % 1) + 1.5) % 1).toBeCloseTo(0.5, 6);
    }
  });
});

describe("ambient", () => {
  it("comes rarely: each kind about as often as its gaps allow over an hour", () => {
    const sky = ambient(variation(9).stream, 0);
    const seen = new Map<AmbientKind, Set<number>>();
    for (let t = 0; t < 3600; t += 1 / 30) {
      for (const happening of Object.values(sky.at(t))) {
        const set = seen.get(happening.kind) ?? new Set<number>();
        set.add(happening.at);
        seen.set(happening.kind, set);
      }
    }
    for (const [kind, { gap, lasts }] of Object.entries(AMBIENT)) {
      const count = seen.get(kind as AmbientKind)?.size ?? 0;
      expect(count).toBeGreaterThanOrEqual(Math.floor(3600 / (gap[1] + lasts)) - 1);
      expect(count).toBeLessThanOrEqual(Math.ceil(3600 / (gap[0] + lasts)) + 1);
    }
  });

  it("is the same sky for the same seed", () => {
    expect(eventsOf(3)).toEqual(eventsOf(3));
    expect(eventsOf(3)).not.toEqual(eventsOf(4));
  });
});

/** A gleam's life sampled at `n` even steps. */
const lifeOf = (n: number) => Array.from({ length: n + 1 }, (_, i) => gleamAt(i / n));
/** How far the gleam travels over the hundredth after `l`. */
const stride = (l: number) => gleamAt(l + 0.01).travel - gleamAt(l).travel;

describe("gleamAt", () => {
  it("crosses once, gathering slowly, quickest at its strike, slowing as it leaves", () => {
    const life = lifeOf(400);
    for (let i = 1; i < life.length; i++) {
      expect(life[i]?.travel ?? 0).toBeGreaterThanOrEqual(life[i - 1]?.travel ?? 0);
    }
    expect(gleamAt(0).travel).toBe(0);
    expect(gleamAt(1).travel).toBeCloseTo(1);
    expect(stride(0.05)).toBeLessThan(stride(0.4));
    expect(stride(0.95)).toBeLessThan(stride(0.5));
  });

  it("is dark at both ends and brightest at its strike", () => {
    expect(gleamAt(0).strength).toBe(0);
    expect(gleamAt(1).strength).toBe(0);
    const brightest = lifeOf(400).reduce((a, b) => (b.strength > a.strength ? b : a));
    expect(brightest.travel).toBeCloseTo(0.5, 1);
  });

  it("splits its colours in two hard steps at the strike, then not at all", () => {
    const splits = lifeOf(1000).map((g) => g.split);
    expect(new Set(splits)).toEqual(new Set([0, 1, -1]));
    const first = splits.indexOf(1);
    const swapped = splits.indexOf(-1);
    expect(first).toBeGreaterThan(0);
    expect(swapped).toBeGreaterThan(first);
    expect(splits.slice(swapped).includes(1)).toBe(false);
  });

  it("flashes at the strike and rings down with ZZZ's overshoot", () => {
    const flashes = lifeOf(2000).map((g) => g.flash);
    expect(Math.max(...flashes)).toBeCloseTo(1, 2);
    expect(Math.min(...flashes)).toBeCloseTo(-0.42, 1);
    expect(Math.abs(gleamAt(1).flash)).toBeLessThan(0.01);
  });
});

describe("compose", () => {
  it("composes each variant the same for the same seed, and anew for another", () => {
    for (const variant of ASTRAL_VARIANTS) {
      expect(compose(variant, variation(5))).toEqual(compose(variant, variation(5)));
      expect(compose(variant, variation(5))).not.toEqual(compose(variant, variation(6)));
    }
  });

  it("gives every composition a hub star and stars of its own, and only finite positions", () => {
    for (const variant of ASTRAL_VARIANTS) {
      const mechanism = compose(variant, variation(1));
      expect(mechanism.variant).toBe(variant);
      const parts = [...walk(mechanism.parts)];
      const stars = parts.filter((p) => p.shape.kind === "star");
      expect(stars.filter((p) => p.shape.kind === "star" && p.shape.hub === true)).toHaveLength(1);
      expect(stars.length).toBeGreaterThan(4);
      for (const part of parts) for (const v of part.at) expect(Number.isFinite(v)).toBe(true);
    }
  });

  it("gives every composition a constellation that fits the sky's slots, its links joining its own stars", () => {
    for (const variant of ASTRAL_VARIANTS) {
      const { constellation } = compose(variant, variation(3));
      expect(constellation.stars.length).toBeGreaterThan(2);
      expect(constellation.stars.length).toBeLessThanOrEqual(CONSTELLATION_POINTS);
      expect(constellation.links.length).toBeLessThanOrEqual(CONSTELLATION_LINKS);
      for (const [from, to] of constellation.links) {
        expect(constellation.stars[from]).toBeDefined();
        expect(constellation.stars[to]).toBeDefined();
      }
    }
  });
});
