import { forwardRef, memo } from "react";
import { describe, expect, test } from "vitest";
import { decodeBackdrop, readBackdrops } from "./backdrop-decode.ts";
import { BACKDROP_BUDGETS } from "@kb/ui-sdk";

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

  test("one that is not what the contract says is refused, with where and why", () => {
    expect(why(backdrop({ interactions: "it swirls" }))).toBe('Expected array at ["interactions"]');
    expect(why(backdrop({ interactions: [{ cue: "wind", does: "it sways" }] }))).toContain(
      'Expected one of pointer, editing, writes, navigation, arrivals, errors, turns at ["interactions"][0]["cue"]',
    );
    expect(why(backdrop({ interactions: [{ cue: 1n, does: "it sways" }] }))).toContain('["cue"]');
    expect(why(backdrop({ interactions: [{ cue: "pointer", does: "a\nb" }] }))).toContain(
      "in one line",
    );
    expect(why(backdrop({ Component: {} }))).toContain("Expected a component");
    expect(why(without("presentation"))).toContain('["presentation"]');
    expect(why(backdrop({ presentation: { ...presentation, directions: ["left"] } }))).toContain(
      '["presentation"]["directions"][0]',
    );
    expect(why(backdrop({ budget: { frameMs: 0 } }))).toContain('["budget"]["frameMs"]');
    expect(why(backdrop({ key: { id: "plug.glow" } }))).toContain('["key"]["label"]');
    expect(why(null)).toBe("Expected object");
  });

  test("its key is checked as every reader reads it: its variants, knobs and credit", () => {
    const key = (more: Record<string, unknown>) =>
      backdrop({ key: { id: "plug.glow", label: "Glow", ...more } });
    expect(why(key({ variants: {} }))).toContain('["key"]["variants"]');
    expect(why(key({ variants: [{ id: "warm" }] }))).toContain('["key"]["variants"][0]["label"]');
    expect(why(key({ credit: { by: "someone" } }))).toContain('["key"]["credit"]');
    expect(why(key({ knobs: [{ kind: "dial", id: "x", label: "X" }] }))).toContain(
      '["key"]["knobs"][0]',
    );
    expect(
      why(
        key({
          variants: [
            {
              id: "warm",
              label: "Warm",
              knobs: [{ kind: "boolean", id: "b", label: "B", default: true }],
            },
          ],
        }),
      ),
    ).toBeNull();
  });

  test("a component React draws as an object (memo, forwardRef) is a component", () => {
    expect(why(backdrop({ Component: memo(Scene) }))).toBeNull();
    expect(why(backdrop({ Component: forwardRef(Scene) }))).toBeNull();
  });

  test("one whose reading throws is refused with what it threw, and is read as a copy", () => {
    const throwing = Object.defineProperty(backdrop(), "budget", {
      enumerable: true,
      get: () => {
        throw new Error("boom");
      },
    });
    expect(why(throwing)).toBe("reading it threw: boom");
    let reads = 0;
    const counted = Object.defineProperty(backdrop(), "budget", {
      enumerable: true,
      get: () => {
        reads += 1;
        return BACKDROP_BUDGETS.canvas;
      },
    });
    const read = decodeBackdrop(counted);
    const before = reads;
    expect(read.ok && read.backdrop.budget).toEqual(BACKDROP_BUDGETS.canvas);
    expect(reads).toBe(before);
  });

  test("a point's list is read one contribution at a time: a refused one leaves the rest", () => {
    const { shown, refused } = readBackdrops([
      contribution("plug.glow", backdrop()),
      contribution(
        "plug.smoke",
        backdrop({ key: { id: "plug.smoke", label: "Smoke" }, interactions: 3 }),
      ),
      contribution("plug.ember", without("interactions")),
      contribution(
        "plug.boom",
        Object.defineProperty({}, "key", {
          get: () => {
            throw new Error("boom");
          },
        }),
      ),
    ]);
    expect(shown.map(({ id }) => id)).toEqual(["plug.glow", "plug.ember"]);
    expect(refused).toEqual([
      {
        id: "plug.smoke",
        owner: "plug",
        label: "Smoke",
        why: 'Expected array at ["interactions"]',
      },
      { id: "plug.boom", owner: "plug", label: null, why: "reading it threw: boom" },
    ]);
  });

  test("a contribution read again, in a new list, is the same value", () => {
    const glow = contribution("plug.glow", backdrop());
    const [first] = readBackdrops([glow]).shown;
    const [again] = readBackdrops([contribution("plug.other", backdrop()), glow]).shown.slice(1);
    expect(again).toBe(first);
  });
});
