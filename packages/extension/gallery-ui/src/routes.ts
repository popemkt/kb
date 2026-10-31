import type { ComposerParams } from "@kb/gallery";

/** The composer's page: `/gallery` asks where to start; `/gallery/<workflow>[/<from>]` opens one. */
export const GALLERY_PATH = "/gallery";

/** The path that opens `workflow` (a workflow's local id), starting from `from` when given. */
export function galleryPath({ workflow, from }: ComposerParams = {}): string {
  if (workflow === undefined) return GALLERY_PATH;
  const base = `${GALLERY_PATH}/${encodeURIComponent(workflow)}`;
  return from === undefined ? base : `${base}/${encodeURIComponent(from)}`;
}

export function matchGallery(path: string): ComposerParams | null {
  const match = /^\/gallery(?:\/([^/]+)(?:\/([^/]+))?)?\/?$/.exec(path);
  if (match === null) return null;
  const [, workflow, from] = match;
  if (workflow === undefined) return {};
  return from === undefined
    ? { workflow: decodeURIComponent(workflow) }
    : { workflow: decodeURIComponent(workflow), from: decodeURIComponent(from) };
}
