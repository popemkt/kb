import type { NoParams } from "@kb/views";

/** The gallery's one page. */
export const GALLERY_PATH = "/gallery";

export function matchGallery(path: string): NoParams | null {
  return path === GALLERY_PATH || path === `${GALLERY_PATH}/` ? {} : null;
}
