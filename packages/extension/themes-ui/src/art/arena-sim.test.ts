import { describe, expect, it } from "vitest";
import {
  ArenaPlay,
  CAPACITY,
  FIELD,
  NUDGE_GAP,
  STILL_VIEW,
  VIEW_HOLD,
  VIEW_MOVE,
  viewAt,
} from "./arena-sim";

const DT = 1 / 30;

/** Every live bullet's place, as pairs. */
function places(play: ArenaPlay): [number, number][] {
  return Array.from({ length: play.count }, (_, i) => [play.u[i] ?? 0, play.v[i] ?? 0]);
}

describe("the Arena's play", () => {
  it("plays the same for the same seed", () => {
    const a = new ArenaPlay(7);
    const b = new ArenaPlay(7);
    a.advance(20);
    b.advance(20);
    expect(places(a)).toEqual(places(b));
  });

  it("arrives mid-play: the machines have loosed orbs, all inside the field and its margin", () => {
    const play = new ArenaPlay(7);
    play.advance(14);
    expect(play.count).toBeGreaterThan(10);
    expect(play.count).toBeLessThanOrEqual(CAPACITY);
    for (const [u, v] of places(play)) {
      expect(Math.abs(u)).toBeLessThanOrEqual(FIELD.halfWidth + 1.5);
      expect(Math.abs(v)).toBeLessThanOrEqual(FIELD.halfDepth + 1.2);
    }
  });

  it("stands still when no time passes, as under reduced motion", () => {
    const play = new ArenaPlay(7);
    play.advance(10);
    const before = places(play);
    play.step(0, { u: 0, v: 0 });
    expect(places(play)).toEqual(before);
  });

  it("a nudge charges the pod, which looses orbs along its spiral, and the charge decays by itself", () => {
    const play = new ArenaPlay(3);
    play.advance(5);
    expect(play.charge).toBe(0);
    play.nudge(0.7);
    play.step(DT, null);
    expect(play.charge).toBeGreaterThan(0.6);
    const before = play.count;
    play.advance(1);
    expect(play.count).toBeGreaterThan(before);
    play.advance(6);
    expect(play.charge).toBeLessThan(0.01);
  });

  it("nudges closer than the gap merge into one, the strongest", () => {
    const play = new ArenaPlay(3);
    play.nudge(0.3);
    play.nudge(0.2);
    play.step(DT, null);
    const landed = play.charge;
    expect(landed).toBeLessThan(0.3);
    expect(landed).toBeGreaterThan(0.28);
    // Inside the gap a nudge waits; past it, it lands.
    play.nudge(0.3);
    play.step(DT, null);
    expect(play.charge).toBeLessThan(landed);
    play.advance(NUDGE_GAP);
    expect(play.charge).toBeGreaterThan(landed);
  });

  it("30 keystrokes and an edit never restart the play: its clock only grows, and no orb is lost to them", () => {
    const play = new ArenaPlay(7);
    play.advance(10);
    let last = play.time;
    for (let key = 0; key < 31; key++) {
      const before = play.count;
      play.nudge(key === 30 ? 0.7 : 0.035);
      for (let i = 0; i < 3; i++) {
        play.step(DT, null);
        expect(play.time).toBeGreaterThan(last);
        last = play.time;
      }
      // Orbs leave only by living out their life or the field, a handful a step at most.
      expect(play.count).toBeGreaterThan(before - 6);
    }
  });

  it("the pointer draws the orbs in: more of them end near it than without it", () => {
    const near = (play: ArenaPlay, at: { u: number; v: number }) =>
      places(play).filter(([u, v]) => Math.hypot(u - at.u, v - at.v) < 1.5).length;
    const at = { u: 1, v: 0 };
    const drawn = new ArenaPlay(11);
    const free = new ArenaPlay(11);
    drawn.advance(8);
    free.advance(8);
    for (let t = 0; t < 6; t += DT) {
      drawn.step(DT, at);
      free.step(DT, null);
    }
    expect(near(drawn, at)).toBeGreaterThan(near(free, at));
  });
});

describe("the Arena's camera", () => {
  it("starts at the still view, and holds it", () => {
    expect(viewAt(0)).toEqual({ ...STILL_VIEW, yaw: STILL_VIEW.yaw });
    expect(viewAt(VIEW_HOLD - 1).pitch).toBe(STILL_VIEW.pitch);
  });

  it("moves rarely and gently: no turn between two frames is more than a sliver", () => {
    let last = viewAt(0);
    for (let t = DT; t < (VIEW_HOLD + VIEW_MOVE) * 4; t += DT) {
      const next = viewAt(t);
      expect(Math.abs(next.pitch - last.pitch)).toBeLessThan(0.02);
      expect(Math.abs(next.yaw - last.yaw)).toBeLessThan(0.02);
      expect(Math.abs(next.hinge - last.hinge)).toBeLessThan(0.02);
      last = next;
    }
  });

  it("turns between 3D, top-down and side-on, standing the field up for the side", () => {
    const cycle = VIEW_HOLD + VIEW_MOVE;
    const held = [0, 1, 2].map((leg) => viewAt(leg * cycle + VIEW_HOLD / 2));
    const [angled, top, side] = held;
    expect(top?.pitch).toBeGreaterThan(1.3);
    expect(side?.pitch).toBeLessThan(0.2);
    expect(side?.hinge).toBeCloseTo(Math.PI / 2);
    expect(angled?.hinge).toBe(0);
    expect(top?.hinge).toBe(0);
    // And round again.
    expect(viewAt(3 * cycle + VIEW_HOLD / 2).pitch).toBeCloseTo(angled?.pitch ?? 0);
  });
});
