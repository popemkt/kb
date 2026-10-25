import { describe, expect, it } from "vitest";
import { IMPULSE_EVERY, startReactions } from "./reactions";

const run = (r: ReturnType<typeof startReactions>, seconds: number, dt = 1 / 60) => {
  for (let t = 0; t < seconds; t += dt) r.update(dt);
};

describe("reactions", () => {
  it("calm eases in while editing and out after, never snapping", () => {
    const r = startReactions();
    r.setEditing(true);
    r.update(1 / 60);
    expect(r.calm).toBeGreaterThan(0);
    expect(r.calm).toBeLessThan(0.1);
    run(r, 6);
    expect(r.calm).toBeGreaterThan(0.95);
    r.setEditing(false);
    r.update(1 / 60);
    expect(r.calm).toBeGreaterThan(0.9);
    run(r, 12);
    expect(r.calm).toBeLessThan(0.05);
  });

  it("a write stirs, quickly up and slowly down", () => {
    const r = startReactions();
    r.write();
    run(r, 0.2);
    const peak = r.stir;
    expect(peak).toBeGreaterThan(0.8);
    run(r, 4);
    expect(r.stir).toBeLessThan(peak * 0.1);
  });

  it("typing keeps it calm: a write while editing does not stir", () => {
    const r = startReactions();
    r.setEditing(true);
    run(r, 6);
    r.write();
    run(r, 0.2);
    expect(r.stir).toBeLessThan(0.1);
  });

  it("a write during an impulse merges into it: the impulse never restarts", () => {
    const r = startReactions();
    r.write();
    run(r, 0.6);
    const before = r.impulse;
    r.write();
    // Never back to nothing and up again: it goes on from where it is, higher.
    r.update(1 / 60);
    expect(r.impulse).toBeGreaterThan(before);
    for (let i = 0; i < 30; i++) {
      r.update(1 / 60);
      expect(r.impulse).toBeGreaterThan(before);
    }
  });

  it("writes closer than IMPULSE_EVERY land as one impulse", () => {
    const once = startReactions();
    once.write();
    for (let i = 0; i < 30; i++) once.update(0.1 / 30);
    const burst = startReactions();
    for (let i = 0; i < 30; i++) {
      burst.write();
      burst.update(0.1 / 30);
    }
    expect(burst.impulse).toBeCloseTo(once.impulse, 5);
    expect(IMPULSE_EVERY).toBeGreaterThanOrEqual(0.12);
    expect(IMPULSE_EVERY).toBeLessThanOrEqual(0.2);
  });

  it("typing is a gentle sustained impulse that eases away when it stops", () => {
    const r = startReactions();
    r.setEditing(true);
    const seen: number[] = [];
    for (let key = 0; key < 30; key++) {
      r.write();
      run(r, 0.1);
      seen.push(r.impulse);
    }
    const held = seen.slice(10);
    expect(Math.min(...held)).toBeGreaterThan(0.1);
    expect(Math.max(...held)).toBeLessThan(0.5);
    r.setEditing(false);
    run(r, 6);
    expect(r.impulse).toBeLessThan(0.02);
  });

  it("navigation is a slower ripple that remembers when it was", () => {
    const r = startReactions();
    expect(r.sinceNavigate()).toBeGreaterThan(1e6);
    r.navigate();
    run(r, 0.5);
    expect(r.ripple).toBeGreaterThan(0.5);
    expect(r.sinceNavigate()).toBeCloseTo(0.5, 1);
  });

  it("the pointer eases in and out, and reports how fast it moves", () => {
    const r = startReactions();
    r.setPointer(10, 10);
    r.update(1 / 60);
    expect(r.pointer.near).toBeGreaterThan(0);
    expect(r.pointer.near).toBeLessThan(0.3);
    run(r, 1);
    expect(r.pointer.near).toBeGreaterThan(0.95);
    r.clearPointer();
    run(r, 3);
    expect(r.pointer.near).toBeLessThan(0.05);
    r.setPointer(0, 0);
    r.update(1 / 60);
    r.setPointer(100, 0);
    r.update(1 / 60);
    expect(r.pointer.speed).toBeGreaterThan(100);
  });
});
