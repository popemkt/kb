/**
 * The outline family's shared package (DESIGN.md → Extension families): its
 * declaration and the shared plugin both hosts build their entries from.
 * The browser half is `@kb/outline-ui`.
 */
export { outlineExtension, outlinePlugin } from "./extension.ts";
export { OUTLINE_IDS } from "./ids.ts";

export {
  OUTLINE_KEYBOARD,
  EDITING_CONTEXT,
  EDITING_CONTEXT_ID,
  EDITING_BINDINGS,
  SELECTION_CONTEXT,
  SELECTION_CONTEXT_ID,
  SELECTION_BINDINGS,
} from "./keyboard.ts";
