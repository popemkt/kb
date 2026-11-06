/**
 * Disc field's own knobs (DESIGN-UI.md → Page-head backdrops → Knobs), after
 * the family's speed and seed (`MOVING_KNOBS`): each wired to what its scene
 * draws, its default the scene as it was drawn before it had a knob.
 */
import type { Knob, NumberKnob } from "@kb/model";

/** How large every disc is painted, against its own draw. */
export const DISC_FIELD_SIZE_KNOB: NumberKnob = {
  kind: "number",
  id: "size",
  label: "Disc size",
  min: 0.7,
  max: 1.3,
  step: 0.05,
  default: 1,
  unit: "×",
};

/** How wide the band is where the painting dissolves into the page, and how many specks it leaves. */
export const DISC_FIELD_SPRAY_KNOB: NumberKnob = {
  kind: "number",
  id: "spray",
  label: "Spray",
  min: 0.5,
  max: 1.6,
  step: 0.1,
  default: 1,
  unit: "×",
};

/** How much the leaves stir on their own; a write's breath of wind comes through whatever it is. */
export const DISC_FIELD_WIND_KNOB: NumberKnob = {
  kind: "number",
  id: "wind",
  label: "Wind",
  min: 0,
  max: 2,
  step: 0.1,
  default: 1,
  unit: "×",
};

export const DISC_FIELD_KNOBS: readonly Knob[] = [
  DISC_FIELD_SIZE_KNOB,
  DISC_FIELD_SPRAY_KNOB,
  DISC_FIELD_WIND_KNOB,
];
