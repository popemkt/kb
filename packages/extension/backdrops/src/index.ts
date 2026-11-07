/**
 * The backdrops family's shared package (DESIGN.md → Extension families;
 * DESIGN-UI.md → Page-head backdrops): its declaration and the shared plugin
 * both hosts build their entries from. The backdrops themselves are page
 * ambience, so they live in the browser half, `@kb/backdrops-ui`.
 */
export {
  BLACK_HOLE_BACKDROP,
  DISC_FIELD_BACKDROP,
  FLOATING_GEOMETRY_BACKDROP,
  GRADIENT_BACKDROP,
  GRADIENT_ORBS_BACKDROP,
  LIGHT_TRAILS_BACKDROP,
  ASTRAL_BACKDROP,
  LENS_BACKDROP,
  ROOST_BACKDROP,
  SILK_BACKDROP,
  SKY_BACKDROP,
  TOON_SEA_BACKDROP,
  UNICORN_BACKDROP,
  WOLF_MEDALLION_BACKDROP,
  backdropsExtension,
  backdropsPlugin,
} from "./extension.ts";
export { MOVING_KNOBS, SEED_KNOB, SPEED_KNOB } from "./knobs.ts";
export { LENS_MASS_KNOB, LENS_HUE_KNOB, LENS_STARS_KNOB, LENS_KNOBS } from "./knobs/lens.ts";
export {
  TOON_SEA_WAVES_KNOB,
  TOON_SEA_CLOUDS_KNOB,
  TOON_SEA_FOAM_KNOB,
  TOON_SEA_KNOBS,
} from "./knobs/toon-sea.ts";
export { SILK_HUE_KNOB, SILK_IRIDESCENCE_KNOB, SILK_KNOBS } from "./knobs/silk.ts";
export {
  GEOMETRY_CRUMPLE_KNOB,
  GEOMETRY_GOLD_KNOB,
  GEOMETRY_SWEEP_KNOB,
  FLOATING_GEOMETRY_KNOBS,
} from "./knobs/floating-geometry.ts";
export {
  ORBS_HUE_KNOB,
  ORBS_SIZE_KNOB,
  ORBS_GLOW_KNOB,
  GRADIENT_ORBS_KNOBS,
} from "./knobs/gradient-orbs.ts";
export {
  MEDALLION_EMBERS_KNOB,
  MEDALLION_SMOKE_KNOB,
  MEDALLION_GLYPHS_KNOB,
  WOLF_MEDALLION_KNOBS,
} from "./knobs/wolf-medallion.ts";
export {
  TRAILS_STRANDS_KNOB,
  TRAILS_FAN_KNOB,
  TRAILS_KNOT_KNOB,
  LIGHT_TRAILS_KNOBS,
} from "./knobs/light-trails.ts";
export {
  DISC_FIELD_SIZE_KNOB,
  DISC_FIELD_SPRAY_KNOB,
  DISC_FIELD_WIND_KNOB,
  DISC_FIELD_KNOBS,
} from "./knobs/disc-field.ts";
export { SKY_FLOCK_KNOB, SKY_GLOW_KNOB, SKY_MOTES_KNOB, SKY_KNOBS } from "./knobs/sky.ts";
export { ROOST_BATS_KNOB, ROOST_WINDOW_KNOB, ROOST_KNOBS } from "./knobs/roost.ts";
export {
  BLACK_HOLE_TILT_KNOB,
  GARGANTUA_BEAMING_KNOB,
  GARGANTUA_HEAT_KNOB,
  WARP_STREAKS_KNOB,
  WARP_PULL_KNOB,
  BLACK_HOLE_KNOBS,
  GARGANTUA_KNOBS,
  WARP_KNOBS,
} from "./knobs/black-hole.ts";
export {
  ASTRAL_SIZE_KNOB,
  ASTRAL_LINE_KNOB,
  ASTRAL_STARS_KNOB,
  ASTRAL_KNOBS,
} from "./knobs/astral.ts";
export { BackdropStudioParams, BackdropStudioView } from "./view.ts";
