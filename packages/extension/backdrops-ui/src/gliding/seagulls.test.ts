import { describe, expect, it } from "vitest";
import { buildSeagullGeometry, evaluateSeagullPose, SEAGULL_SPECS } from "./seagulls";

describe("buildSeagullGeometry", () => {
  it("produces distinct finite geometries for broad, swept, and slender bird variants", () => {
    for (const variant of ["broad", "swept", "slender"] as const) {
      const geo = buildSeagullGeometry(variant);
      try {
        const pos = geo.getAttribute("position");
        const col = geo.getAttribute("color");
        const span = geo.getAttribute("aWingSpan");
        expect(pos.count).toBeGreaterThan(180);
        expect(col.count).toBe(pos.count);
        expect(span.count).toBe(pos.count);
        let maxSpan = 0;
        for (let i = 0; i < pos.count; i++) {
          expect(Number.isFinite(pos.getX(i))).toBe(true);
          expect(Number.isFinite(pos.getY(i))).toBe(true);
          expect(Number.isFinite(pos.getZ(i))).toBe(true);
          const s = span.getX(i);
          expect(s).toBeGreaterThanOrEqual(0);
          expect(s).toBeLessThanOrEqual(1);
          if (s > maxSpan) maxSpan = s;
        }
        expect(maxSpan).toBeCloseTo(1, 5);
      } finally {
        geo.dispose();
      }
    }
  });
});

describe("evaluateSeagullPose", () => {
  it("holds the curated still pose under reduced motion", () => {
    const spec = SEAGULL_SPECS[0];
    expect(spec).toBeDefined();
    if (!spec) return;
    const a = evaluateSeagullPose(spec, 0, true);
    const b = evaluateSeagullPose(spec, 14.5, true);
    expect(a).toEqual(b);
    expect(a.x).toBe(spec.x);
    expect(a.y).toBe(spec.y);
    expect(a.altitude).toBe(spec.altitude);
  });

  it("actively glides forward across the ocean along curved paths with varying altitude and wingbeats", () => {
    const spec = SEAGULL_SPECS[0];
    expect(spec).toBeDefined();
    if (!spec) return;
    const start = evaluateSeagullPose(spec, 0, false);
    const later = evaluateSeagullPose(spec, 4.0, false);
    const travel = Math.hypot(later.x - start.x, later.y - start.y);
    expect(travel).toBeGreaterThan(0.2);

    let minAlt = Infinity;
    let maxAlt = -Infinity;
    let minInner = Infinity;
    let maxInner = -Infinity;
    for (let t = 0; t < 24; t += 0.2) {
      const p = evaluateSeagullPose(spec, t, false);
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
      expect(Number.isFinite(p.heading)).toBe(true);
      minAlt = Math.min(minAlt, p.altitude);
      maxAlt = Math.max(maxAlt, p.altitude);
      minInner = Math.min(minInner, p.inner);
      maxInner = Math.max(maxInner, p.inner);
    }
    expect(maxAlt - minAlt).toBeGreaterThan(0.2);
    expect(maxInner - minInner).toBeGreaterThan(0.25);
  });

  it("gains forward speed in a dive and eases off during a climb", () => {
    const swooper = SEAGULL_SPECS.find((bird) => bird.glideStyle === "swoop");
    if (!swooper) throw new Error("Expected a swooping gull");
    // A northbound gull's y displacement measures its forward travel independently of banking.
    const bird = { ...swooper, heading: 0, phase: 0, x: 0, y: 0 };
    let climbs = 0;
    let dives = 0;
    for (let t = 0; t < 16; t += 0.2) {
      const a = evaluateSeagullPose(bird, t, false);
      const b = evaluateSeagullPose(bird, t + 0.01, false);
      const dy = b.y - a.y;
      if (Math.abs(dy) > 0.88) continue; // Crossing the viewport wrap.
      if (b.altitude > a.altitude) {
        expect(dy / 0.01).toBeLessThan(bird.speed);
        climbs++;
      } else {
        expect(dy / 0.01).toBeGreaterThan(bird.speed);
        dives++;
      }
    }
    expect(climbs).toBeGreaterThan(0);
    expect(dives).toBeGreaterThan(0);
  });

  it("includes high-soaring gulls above WB-027 altitude (1.38) and multiple distinct glide styles", () => {
    const highBirds = SEAGULL_SPECS.filter((s) => s.altitude > 1.38);
    const lowBirds = SEAGULL_SPECS.filter((s) => s.altitude < 1.38);
    expect(highBirds.length).toBeGreaterThanOrEqual(2);
    expect(lowBirds.length).toBeGreaterThanOrEqual(4);
    const styles = new Set(SEAGULL_SPECS.map((s) => s.glideStyle));
    expect(styles.size).toBeGreaterThanOrEqual(4);
  });
});
