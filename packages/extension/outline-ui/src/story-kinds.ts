import { syncUiPlugins } from "@kb/ui-sdk";
import { outlineValueKindsPlugin } from "./slot-kind";

/**
 * A story's `beforeEach`: the outline's kinds of the built-in field types,
 * as the page holds them while the outline is loaded, so a field drawn on its
 * own in the catalog draws its values.
 */
export function withValueKinds(): () => void {
  syncUiPlugins([outlineValueKindsPlugin]);
  return () => syncUiPlugins([]);
}
