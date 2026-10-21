import type { NoParams } from "@kb/views";
import { outlineLocationOf } from "@kb/ui-sdk";

/**
 * The outline owns `/` and `/outline/<id>`: the page's outline at its home
 * and zoomed to a node. Which node the page stands at follows the path
 * (`followOutlineLocation`), so the view itself takes no params.
 */
export function matchOutline(path: string): NoParams | null {
  return outlineLocationOf(path)?.ontology === null ? {} : null;
}
