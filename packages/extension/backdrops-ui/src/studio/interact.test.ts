import { describe, expect, test } from "vitest";
import { QUIET_ACTIVITY } from "@kb/ui-sdk";
import { TYPING_KEYSTROKES, afterMoment, typingBurst } from "./interact";

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
});
