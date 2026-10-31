/**
 * Capture's writes beyond a picture dropped or pasted (`../upload.ts`): a
 * link kept, and a style given to a visual in triage, through the page's
 * one invoke path.
 */
import { GALLERY_ACTIONS, GALLERY_IDS } from "@kb/gallery";
import { browserHost, toast } from "@kb/ui-sdk";
import { addNode } from "../add-node";
import { linkVisualInput, type CapturedLink } from "./capture-model";

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

/**
 * Keep `link` as a visual; its id, or null after saying why not. The
 * server fetches the picture from the image hosts it lists
 * (`ext.gallery.capture`); a link to any other host is refused, and is
 * kept as a link alone: a visual with its source and no media.
 */
export async function addLinkVisual(
  link: CapturedLink,
  parent: string | null,
): Promise<string | null> {
  const receipt = await browserHost().invoke(GALLERY_ACTIONS.capture, {
    url: link.url,
    text: link.name,
    ...(parent === null ? {} : { parent }),
  });
  if (receipt.status === "succeeded") {
    const id = isRecord(receipt.output) ? receipt.output["id"] : undefined;
    return typeof id === "string" ? id : null;
  }
  if (receipt.code !== "forbidden") {
    toast(`Could not keep the picture: ${receipt.message}`);
    return null;
  }
  toast(`${receipt.message}: the link is kept, not the picture`);
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
