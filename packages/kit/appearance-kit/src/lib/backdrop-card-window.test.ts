import { describe, expect, it } from "vitest";
import { cardWindowTop } from "./backdrop-card-window.ts";
import type { BackdropPresentation } from "./appearance-points.ts";

const frame = (
  space: number,
  directions: BackdropPresentation["directions"],
): BackdropPresentation => ({
  space,
  height: 380,
  span: { reach: "content", maxWidth: 1040 },
  offset: -10,
  directions,
  opacity: { subtle: 0.5, soft: 0.7, vivid: 0.9 },
});

describe("cardWindowTop", () => {
  it("looks at the frame's top for a backdrop with no direction: its hero is in the breathing room", () => {
    expect(cardWindowTop(frame(120, []), "down", 150)).toBe(0);
    expect(cardWindowTop(frame(120, []), "up", 150)).toBe(0);
  });

  it("centres a directional backdrop's window on its content's line, from the side it faces", () => {
    expect(cardWindowTop(frame(140, ["down", "up"]), "down", 150)).toBe(65);
    expect(cardWindowTop(frame(140, ["down", "up"]), "up", 150)).toBe(380 - 140 - 75);
  });

  it("never looks past the frame's top or bottom", () => {
    expect(cardWindowTop(frame(40, ["down", "up"]), "down", 150)).toBe(0);
    expect(cardWindowTop(frame(40, ["down", "up"]), "up", 150)).toBe(380 - 150);
    expect(cardWindowTop(frame(140, ["down", "up"]), "down", 500)).toBe(0);
  });
});
