import { bundledPlugin } from "@kb/contracts";
import { outlineExtension } from "@kb/outline";
import { outlineUiPlugin as entry } from "@kb/outline-ui";

/** The outline entry admitted by the test's bundled page composition. */
export const outlineUiPlugin = bundledPlugin(outlineExtension, entry);
