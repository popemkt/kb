/**
 * The themes family's shared package (DESIGN.md → Extension families;
 * DESIGN-UI.md → Design tokens → Design systems): its declaration and the
 * shared plugin both hosts build their entries from. The design systems
 * themselves are page stylesheets, so they live in the browser half,
 * `@kb/themes-ui`.
 */
export {
  BROADCAST_BACKDROP,
  BUNKER_BACKDROP,
  CLOUDBANK_BACKDROP,
  HOLLOW_BACKDROP,
  OVC_BACKDROP,
  PAPER_DESIGN_SYSTEM,
  TERMINAL_DESIGN_SYSTEM,
  TRANSISTOR_DESIGN_SYSTEM,
  YORHA_DESIGN_SYSTEM,
  ZZZ_DESIGN_SYSTEM,
  themesExtension,
  themesPlugin,
} from "./extension.ts";
