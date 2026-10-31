/**
 * Capture's writes beyond a picture kept (`../upload.ts`): a link kept as a
 * visual, and a style given to a visual in triage. Both are core's
 * `node.add` and `node.update`, through the page's one invoke path.
 */
import { GALLERY_IDS } from "@kb/gallery";
import { browserHost, toast } from "@kb/ui-sdk";
import { addNode } from "../add-node";
import { linkVisualInput, type CapturedLink } from "./capture-model";

/**
 * Keep `link` as a visual with its source and no media; its id, or null
 * after saying why not. kb has no action that downloads a picture from any
 * https host, and the gallery deliberately adds none (`admitted` in
 * `@kb/gallery-net`), so the link is what is kept.
 */
export async function addLinkVisual(
  link: CapturedLink,
  parent: string | null,
): Promise<string | null> {
  // GAP [[01M66SF67J0TDSK1R85KYBYVBD]]: the link is kept, not the picture.
  return addNode(linkVisualInput(link, parent), "Could not keep the link");
}

/** Give `visual` the style `style` (the visual's styles, not the look's); false after saying why not. */
export async function addStyleToVisual(visual: string, style: string): Promise<boolean> {
  const receipt = await browserHost().invoke("node.update", {
    id: visual,
    setProps: [{ field: GALLERY_IDS.stylesField, value: { t: "ref", v: style } }],
  });
  if (receipt.status === "failed") {
    toast(`Could not add the style: ${receipt.message}`);
    return false;
  }
  return true;
}
