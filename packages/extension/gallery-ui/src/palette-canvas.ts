/**
 * The browser's half of a look's palette: each pinned picture drawn small
 * on a canvas element, its pixels read and handed to `paletteOf`. Small, so
 * a palette from a dozen pins costs a few milliseconds and no server call.
 */
import { paletteOf } from "@kb/gallery";
import { assetSrcUrl } from "@kb/ui-sdk";

/** The side a picture is drawn at to be read. */
const SIDE = 48;

function pixelsOf(src: string): Promise<Uint8ClampedArray | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.addEventListener("load", () => {
      const canvas = document.createElement("canvas");
      canvas.width = SIDE;
      canvas.height = SIDE;
      const context = canvas.getContext("2d");
      if (context === null) return resolve(null);
      context.drawImage(img, 0, 0, SIDE, SIDE);
      try {
        resolve(context.getImageData(0, 0, SIDE, SIDE).data);
      } catch {
        // A picture from another origin that does not allow reading taints the canvas.
        resolve(null);
      }
    });
    img.addEventListener("error", () => resolve(null));
    img.src = assetSrcUrl(src);
  });
}

/** The palette of the pictures at `covers` (asset paths), up to `count` swatches. */
export async function paletteOfPictures(
  covers: readonly string[],
  count = 6,
): Promise<readonly string[]> {
  const read = await Promise.all(covers.map(pixelsOf));
  const all = read.filter((px): px is Uint8ClampedArray => px !== null);
  const joined = new Uint8ClampedArray(all.reduce((n, px) => n + px.length, 0));
  let at = 0;
  for (const px of all) {
    joined.set(px, at);
    at += px.length;
  }
  return paletteOf(joined, count);
}
