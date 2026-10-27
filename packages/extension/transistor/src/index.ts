/**
 * The Transistor family's shared package (DESIGN.md → Extension families;
 * DESIGN-UI.md → Themes): its declaration and the shared plugin both hosts
 * build their entries from. The theme's sheet, faces and art are the page's,
 * so they live in the browser half, `@kb/transistor-ui`.
 */
export {
  CLOUDBANK_BACKDROP,
  OVC_BACKDROP,
  TRANSISTOR_DESIGN_SYSTEM,
  transistorExtension,
  transistorPlugin,
} from "./extension.ts";
