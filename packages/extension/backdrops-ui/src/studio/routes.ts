import type { BackdropStudioParams } from "@kb/backdrops";

/** `/backdrops` (the gallery) or `/backdrops/<id>` (one backdrop, by its declared id). */
export function matchStudio(path: string): BackdropStudioParams | null {
  if (path === "/backdrops" || path === "/backdrops/") return {};
  const id = /^\/backdrops\/([^/]+)\/?$/.exec(path)?.[1];
  return id === undefined ? null : { backdrop: decodeURIComponent(id) };
}

/** Where the studio shows the backdrop `id`; none, the gallery. */
export function studioPath(id?: string): string {
  return id === undefined ? "/backdrops" : `/backdrops/${encodeURIComponent(id)}`;
}
