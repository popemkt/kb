/**
 * The backdrops family's shared package (DESIGN.md → Extension families;
 * DESIGN-UI.md → Page-head backdrops): its declaration and the shared plugin
 * both hosts build their entries from. The backdrops themselves are page
 * ambience, so they live in the browser half, `@kb/backdrops-ui`.
 */
export {
  BLACK_HOLE_BACKDROP,
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
