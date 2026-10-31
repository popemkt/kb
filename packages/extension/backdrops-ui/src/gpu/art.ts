/**
 * The art a GPU backdrop draws in place of its own, as the art setting's URL
 * names it (`GpuLook.art`, DESIGN-UI.md → Page-head backdrops → The art
 * setting): an image is the hero picture alone; an art manifest is read
 * into its parts (`@kb/model`'s `backdropArtOf`). One reading for every
 * backdrop, so each takes the parts it has and draws its own for the rest.
 */
import { OWN_ART, backdropArtOf, imageArt, isArtManifest, type BackdropArt } from "@kb/model";

/** The art at `url` (null, none): an image at once, a manifest once fetched. */
export async function loadBackdropArt(url: string | null): Promise<BackdropArt> {
  if (url === null) return OWN_ART;
  if (!isArtManifest(url)) return imageArt(url);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`backdrop art ${url}: ${response.status}`);
  const manifest: unknown = await response.json();
  return backdropArtOf(manifest, url);
}
