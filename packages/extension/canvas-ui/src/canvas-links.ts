/**
 * Following an item's link (DESIGN.md → Canvas documents, `link`): where it
 * leads, as the one step the page takes for it — out to a web address, to
 * another page (a canvas, an item on it shown, or any other node), or to an
 * item on this canvas, which is shown and selected.
 */
import { isLinkUrl, type CanvasItemLink, type CanvasWorld } from "@kb/canvas";
import { nodePath } from "@kb/ui-sdk";
import { canvasPath } from "./routes";

export type LinkStep =
  | { readonly kind: "web"; readonly url: string }
  | { readonly kind: "path"; readonly path: string }
  | { readonly kind: "here"; readonly item: string };

/**
 * Where `link`, on canvas `here`, leads; null for a link to this canvas that
 * names no item, or for an address a link may not lead to (`isLinkUrl`):
 * this is the one step every follow takes (link marks, the inspector, the
 * keyboard), so it is where an address is checked before the page opens it,
 * whatever handed the link over.
 */
export function linkStep(link: CanvasItemLink, here: string, world: CanvasWorld): LinkStep | null {
  if ("url" in link) return isLinkUrl(link.url) ? { kind: "web", url: link.url } : null;
  const node = "node" in link ? link.node : here;
  if (node === here) return link.item === undefined ? null : { kind: "here", item: link.item };
  if (world.docOf(node) === undefined) return { kind: "path", path: nodePath(node) };
  const item = link.item === undefined ? {} : { item: link.item };
  return { kind: "path", path: canvasPath({ id: node, ...item }) };
}
