/**
 * A new style, where a word the library does not have yet is first used:
 * a node tagged `#style` under the facet it belongs to, added to the look.
 * So the library grows as it is used, as ordinary nodes the person owns.
 */
import { GALLERY_IDS } from "@kb/gallery";
import { addNode } from "./add-node";
import { addDraftStyles } from "./draft";

/** Add `text` as a style under `facet`, and to the look; its id, or null after saying why not. */
export async function addStyle(text: string, facet: string): Promise<string | null> {
  const id = await addNode(
    { text, parent: facet, tags: [GALLERY_IDS.styleTag] },
    "Could not add the style",
  );
  if (id === null) return null;
  addDraftStyles([id]);
  return id;
}
