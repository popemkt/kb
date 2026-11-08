import { describe, expect, test } from "vitest";
import { decodeBackdrop, readBackdrops } from "./backdrop-decode";
import { BACKDROP_BUDGETS } from "./plugins";

const presentation = {
  space: 40,
  height: 200,
  span: { reach: "region" },
  offset: 0,
  directions: ["down"],
  opacity: { subtle: 0.3, soft: 0.5, vivid: 0.8 },
};
const Scene = () => null;
const backdrop = (more: Record<string, unknown> = {}) => ({
  key: { id: "plug.glow", label: "Glow" },
  presentation,
  budget: BACKDROP_BUDGETS.canvas,
  interactions: [{ cue: "pointer", does: "a lamp follows the cursor" }],
  Component: Scene,
  ...more,
});
const without = (field: string) => {
  const value: Record<string, unknown> = backdrop();
  Reflect.deleteProperty(value, field);
  return value;
};
const why = (value: unknown) => {
  const read = decodeBackdrop(value);
  return read.ok ? null : read.why;
};

/** One contribution as the kernel holds it, its value as the page half handed it. */
const contribution = (id: string, value: unknown) =>
  ({ id, aliases: [], owner: "plug", value }) as Parameters<typeof readBackdrops>[0][number];

describe("a backdrop as the page reads it", () => {
  test("one the contract describes is read as it is", () => {
    const read = decodeBackdrop(backdrop());
    expect(read.ok && read.backdrop).toMatchObject(backdrop());
  });

  test("one built before interactions were required answers nothing, and is drawn", () => {
    const read = decodeBackdrop(without("interactions"));
    expect(read.ok && read.backdrop.interactions).toEqual([]);
  });

  test("one that is not what the contract says is refused, with why", () => {
    expect(why(backdrop({ interactions: "it swirls" }))).toBe("its interactions are not a list");
    expect(why(backdrop({ interactions: [{ cue: "wind", does: "it sways" }] }))).toContain(
      'cue "wind"',
    );
    expect(why(backdrop({ interactions: [{ cue: "pointer", does: "a\nb" }] }))).toContain(
      "in one line",
    );
    expect(why(without("Component"))).toBe("its Component is not a component");
    expect(why(without("presentation"))).toBe("its presentation is not an object");
    expect(why(backdrop({ presentation: { ...presentation, directions: ["left"] } }))).toContain(
      "directions",
    );
    expect(why(backdrop({ budget: { frameMs: 0 } }))).toContain("frameMs");
    expect(why(backdrop({ key: { id: "plug.glow" } }))).toBe("its key has no id and label");
    expect(why(null)).toBe("it is not an object");
  });

  test("a point's list is read one contribution at a time: a refused one leaves the rest", () => {
    const { shown, refused } = readBackdrops([
      contribution("plug.glow", backdrop()),
      contribution(
        "plug.smoke",
        backdrop({ key: { id: "plug.smoke", label: "Smoke" }, interactions: 3 }),
      ),
      contribution("plug.ember", without("interactions")),
    ]);
    expect(shown.map(({ id }) => id)).toEqual(["plug.glow", "plug.ember"]);
    expect(refused).toEqual([
      { id: "plug.smoke", owner: "plug", label: "Smoke", why: "its interactions are not a list" },
    ]);
  });
});
