/**
 * The YoRHa family's shared package (DESIGN.md → Extension families;
 * DESIGN-UI.md → Themes): its declaration and the shared plugin both hosts
 * build their entries from. The theme's sheet, faces and art are the page's,
 * so they live in the browser half, `@kb/yorha-ui`.
 */
export {
  ARENA_BACKDROP,
  BUNKER_BACKDROP,
  YORHA_DESIGN_SYSTEM,
  yorhaExtension,
  yorhaPlugin,
} from "./extension.ts";
