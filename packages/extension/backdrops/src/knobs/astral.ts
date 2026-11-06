/**
 * Astral's own knobs (DESIGN-UI.md → Page-head backdrops → Knobs), after the
 * family's speed and seed (`MOVING_KNOBS`): the backdrop's, shown with every
 * composition, and each composition's own (`BackdropVariant.knobs`), its
 * defaults the composition as it was drawn before it had a knob. No
 * composition has one of its own yet: what an owner tunes (the
 * instrument's size, its ink, the sky's stars) is every composition's.
 */
import type { Knob, NumberKnob } from "@kb/model";

/** How large the instrument is drawn, against its composition's own size in the frame. */
export const ASTRAL_SIZE_KNOB: NumberKnob = {
  kind: "number",
  id: "size",
  label: "Instrument size",
  min: 0.75,
  max: 1.15,
  step: 0.05,
  default: 1,
  unit: "×",
};

/** How heavy the inked lines of the instrument are, against a hairline. */
export const ASTRAL_LINE_KNOB: NumberKnob = {
  kind: "number",
  id: "line",
  label: "Line weight",
  min: 0.6,
  max: 2,
  step: 0.1,
  default: 1,
  unit: "×",
};

/** How brightly the sky's field of tiny stars and glints shows (printed, on paper); 0 an empty sky. */
export const ASTRAL_STARS_KNOB: NumberKnob = {
  kind: "number",
  id: "stars",
  label: "Sky stars",
  min: 0,
  max: 2,
  step: 0.1,
  default: 1,
  unit: "×",
};

export const ASTRAL_KNOBS: readonly Knob[] = [
  ASTRAL_SIZE_KNOB,
  ASTRAL_LINE_KNOB,
  ASTRAL_STARS_KNOB,
];
