/**
 * What the page adds to node text's inline grammar (`@kb/model`'s
 * `inline.ts`): the type-scale class its edit and view share, and where an
 * asset is served from.
 */
import { assetUrl, isAssetPath } from "@kb/model";

/** Shared type-scale class: edit + view must use this for equal line-height. */
export const KB_TEXT_CLASS = "kb-text";

/** Asset hrefs become /assets/… for the kb ui static route. */
export function assetSrcUrl(href: string): string {
  const h = href.trim();
  if (h.startsWith("/")) return h;
  if (isAssetPath(h)) return assetUrl(h);
  return h;
}
