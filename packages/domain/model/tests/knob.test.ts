/**
 * A knob's schema (`knob.ts`; DESIGN-UI.md → Page-head backdrops → Knobs):
 * what a declaration may say about its knobs, so a schema no control can
 * draw, or whose default its own range refuses, is refused where it is
 * declared rather than drawn wrong.
 */
import { describe, expect, test } from "bun:test";
import { knobDefaults, knobSchemaError, type Knob } from "../src/index.ts";

const SPEED: Knob = {
  kind: "number",
  id: "speed",
  label: "Speed",
  min: 0,
  max: 2,
  step: 0.05,
  default: 1,
};
const LOOK: Knob = {
  kind: "enum",
  id: "look",
  label: "Look",
  options: [
    { id: "glow", label: "Glow" },
    { id: "ink", label: "Ink" },
  ],
  default: "glow",
};
const TINT: Knob = { kind: "color", id: "tint", label: "Tint", default: "#ff8800" };
const SEED: Knob = { kind: "seed", id: "seed", label: "Seed", default: null };
const GRAIN: Knob = { kind: "boolean", id: "grain", label: "Grain", default: true };

describe("knobSchemaError", () => {
  test("a schema of every kind, each default its own, is well formed", () => {
    expect(knobSchemaError([SPEED, LOOK, TINT, SEED, GRAIN])).toBeNull();
    expect(knobSchemaError([])).toBeNull();
  });

  test("two knobs under one id are refused", () => {
    expect(knobSchemaError([SPEED, { ...GRAIN, id: "speed" }])).toContain("speed");
  });

  test("a number's default outside its range, or off its step, is refused", () => {
    expect(knobSchemaError([{ ...SPEED, default: 3 }])).toContain("speed");
    expect(knobSchemaError([{ ...SPEED, default: 1.01 }])).toContain("speed");
    expect(knobSchemaError([{ ...SPEED, min: 2, max: 0 }])).toContain("speed");
    expect(knobSchemaError([{ ...SPEED, step: 0 }])).toContain("speed");
  });

  test("an enum whose default is none of its options, or with an option twice, is refused", () => {
    expect(knobSchemaError([{ ...LOOK, default: "neon" }])).toContain("look");
    expect(
      knobSchemaError([{ ...LOOK, options: [...LOOK.options, { id: "ink", label: "Ink" }] }]),
    ).toContain("look");
  });

  test("a colour's default is #rrggbb", () => {
    expect(knobSchemaError([{ ...TINT, default: "orange" }])).toContain("tint");
  });

  test("a seed's default is a whole number, or none (a new one each load)", () => {
    expect(knobSchemaError([{ ...SEED, default: 42 }])).toBeNull();
    expect(knobSchemaError([{ ...SEED, default: 4.2 }])).toContain("seed");
  });

  test("a knob may have only one seed", () => {
    expect(knobSchemaError([SEED, { ...SEED, id: "other" }])).toContain("seed");
  });
});

describe("knobDefaults", () => {
  test("each knob's declared default, by id", () => {
    expect(knobDefaults([SPEED, TINT, SEED])).toEqual({ speed: 1, tint: "#ff8800", seed: null });
  });
});
