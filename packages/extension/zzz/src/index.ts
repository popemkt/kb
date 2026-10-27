/**
 * The ZZZ family's shared package (DESIGN.md → Extension families;
 * DESIGN-UI.md → Themes): its declaration and the shared plugin both hosts
 * build their entries from. The theme's sheet, faces and art are the page's,
 * so they live in the browser half, `@kb/zzz-ui`.
 */
export {
  BROADCAST_BACKDROP,
  HOLLOW_BACKDROP,
  ZZZ_DESIGN_SYSTEM,
  zzzExtension,
  zzzPlugin,
} from "./extension.ts";
