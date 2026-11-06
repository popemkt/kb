/**
 * The knobs every moving backdrop of the family has (DESIGN-UI.md →
 * Page-head backdrops → Knobs), declared once and implemented once, by the
 * family's two hosts: the GPU host (`mountBackdrop`) and the 2D stage. A
 * backdrop that moves lists them first on its key.
 */
import type { NumberKnob, SeedKnob } from "@kb/model";

/** How fast the picture moves: its time scaled, 0 a held frame. The owner's reactions keep their own. */
export const SPEED_KNOB: NumberKnob = {
  kind: "number",
  id: "speed",
  label: "Speed",
  min: 0,
  max: 3,
  step: 0.05,
  default: 1,
  unit: "×",
};

/** The seed its variation is drawn from: pinned, one composition every load; none, a new one each. */
export const SEED_KNOB: SeedKnob = { kind: "seed", id: "seed", label: "Seed", default: null };

/** The two, in the order a backdrop lists them. */
export const MOVING_KNOBS = [SPEED_KNOB, SEED_KNOB] as const;
