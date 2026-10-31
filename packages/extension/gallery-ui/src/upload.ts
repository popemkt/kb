/**
 * A picture the person drops or pastes, kept: its bytes written as an asset
 * through core's `asset.upload`, and, when asked, made a visual through
 * `node.add`, with its size, so the grid has its aspect before it loads.
 * The gallery writes nothing any other way.
 */
import { GALLERY_IDS } from "@kb/gallery";
import { browserHost, toast } from "@kb/ui-sdk";
import { addNode } from "./add-node";

/** A picture written as an asset: its path, and its pixel size when it could be read. */
export interface Uploaded {
  readonly path: string;
  readonly width: number | null;
  readonly height: number | null;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

function base64Of(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes);
  let binary = "";
  // In slices: one call per byte would be slow, one call for all would overflow the stack.
  for (let i = 0; i < view.length; i += 0x8000) {
    binary += String.fromCharCode(...view.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

async function sizeOf(file: Blob): Promise<{ width: number | null; height: number | null }> {
  try {
    const bitmap = await createImageBitmap(file);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  } catch {
    return { width: null, height: null };
  }
}

/** Write `file` as an asset; its path and size, or null after saying why not. */
export async function uploadPicture(file: File): Promise<Uploaded | null> {
  if (!file.type.startsWith("image/")) {
    toast(`“${file.name}” is not a picture`);
    return null;
  }
  const [bytes, size] = await Promise.all([file.arrayBuffer(), sizeOf(file)]);
  const receipt = await browserHost().invoke("asset.upload", {
    bytes: base64Of(bytes),
    encoding: "base64",
    filename: file.name,
    ext: file.type.slice("image/".length).replace("jpeg", "jpg").replace("svg+xml", "svg"),
  });
  if (receipt.status === "failed") {
    toast(`Could not keep “${file.name}”: ${receipt.message}`);
    return null;
  }
  const path = isRecord(receipt.output) ? receipt.output["path"] : undefined;
  return typeof path === "string" ? { path, ...size } : null;
}

const num = (field: string, v: number | null) =>
  v === null ? [] : [{ field, value: { t: "num", v } }];

/** Make `picture` a visual named `text` under `parent`; its id, or null after saying why not. */
export async function addVisual(
  picture: Uploaded,
  text: string,
  parent: string | null,
): Promise<string | null> {
  return addNode(
    {
      text,
      tags: [GALLERY_IDS.visualTag],
      ...(parent === null ? {} : { parent }),
      props: [
        { field: GALLERY_IDS.mediaField, value: { t: "str", v: `![${text}](${picture.path})` } },
        ...num(GALLERY_IDS.widthField, picture.width),
        ...num(GALLERY_IDS.heightField, picture.height),
      ],
    },
    "Could not add the visual",
  );
}

/** The picture files a drop or a paste carries. */
export function picturesOf(data: DataTransfer | null): readonly File[] {
  return [...(data?.files ?? [])].filter((f) => f.type.startsWith("image/"));
}
