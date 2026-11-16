/**
 * The five places a field may be drawn on a node (DESIGN.md → Data model →
 * field display), and the option node of `sys.f.show` that names each: the
 * one vocabulary the seed writes (`seededField`'s `show`) and the show
 * reader (`field-display.ts`) reads.
 */
import { SYSTEM_IDS, type NodeId } from "./model.ts";

/**
 * Where a field is drawn on a node that has it: a row always, a row where
 * filled (a chip where empty), a chip, tucked behind the chips' "…", or
 * nowhere but debug.
 */
export const FIELD_SHOWS = ["always", "filled", "hidden", "tucked", "never"] as const;
export type FieldShow = (typeof FIELD_SHOWS)[number];

/** Each show's option node: a child of `sys.f.show`. */
export const FIELD_SHOW_OPTION_IDS: Readonly<Record<FieldShow, NodeId>> = {
  always: SYSTEM_IDS.showAlways,
  filled: SYSTEM_IDS.showFilled,
  hidden: SYSTEM_IDS.showHidden,
  tucked: SYSTEM_IDS.showTucked,
  never: SYSTEM_IDS.showNever,
};
