/**
 * A whole theme as declared data (DESIGN-UI.md → Themes): a design system
 * whose option chooses the page-head backdrop it pairs with and holds the
 * motion preset the page moves by, and the backdrops that belong to it,
 * each choosing it. Whichever family brings a theme declares it with these,
 * so the shape of a theme is stated once, never per family.
 */
import { BACKDROP_OPTIONS, type SeedBackdrop } from "./backdrop.ts";
import type { SeedOption } from "./declared-option.ts";
import { DESIGN_SYSTEM_OPTIONS } from "./design-system.ts";
import { motionPresetProps, type MotionPreset } from "./motion.ts";

/**
 * A theme's design system: its option chooses the backdrop `pairsWith`, so
 * a page head shows it while no page and no setting chooses another, and
 * holds its motion preset, which the page moves by while core's node sets
 * no motion option (DESIGN-UI.md → Motion options).
 */
export function themeSystem(
  id: string,
  label: string,
  pairsWith: string,
  motion: MotionPreset,
): SeedOption {
  return {
    id,
    label,
    chooses: [{ kind: BACKDROP_OPTIONS, id: pairsWith }],
    props: motionPresetProps(motion),
  };
}

/** A backdrop that belongs to the theme `system`: its option chooses the system. */
export function themeBackdrop(id: string, label: string, system: string): SeedBackdrop {
  return { id, label, chooses: [{ kind: DESIGN_SYSTEM_OPTIONS, id: system }] };
}
