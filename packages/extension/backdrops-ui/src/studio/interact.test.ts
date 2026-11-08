import { describe, expect, test } from "vitest";
import { QUIET_ACTIVITY } from "@kb/ui-sdk";
import { TYPING_KEYSTROKES, afterMoment, gatedPointer, typingBurst } from "./interact";

describe("the studio's Interact", () => {
  test("a moment acted out is that one cue counted once more, and nothing else", () => {
    expect(afterMoment(QUIET_ACTIVITY, "arrivals")).toEqual({ ...QUIET_ACTIVITY, arrivals: 1 });
    expect(afterMoment(afterMoment(QUIET_ACTIVITY, "writes"), "writes").writes).toBe(2);
  });

  test("a burst of typing is editing with a write a keystroke, in order, and ends not editing", () => {
    const burst = typingBurst();
    const ats = burst.map(({ at }) => at);
    expect(ats).toEqual(ats.toSorted((a, b) => a - b));
    let activity = QUIET_ACTIVITY;
    for (const [i, { step }] of burst.entries()) {
      activity = step(activity);
      expect(activity.editing).toBe(i < burst.length - 1);
    }
    expect(activity).toEqual({ ...QUIET_ACTIVITY, writes: TYPING_KEYSTROKES, editing: false });
  });

  test("the pointer reaches the scene only while Interact is on, through one source", () => {
    const gate = gatedPointer({ now: () => ({ x: 12, y: 34 }) });
    const { pointer } = gate;
    expect(pointer.now()).toBeNull();
    gate.open(true);
    expect(pointer.now()).toEqual({ x: 12, y: 34 });
    gate.open(false);
    expect(gate.pointer).toBe(pointer);
    expect(pointer.now()).toBeNull();
  });
});
