/**
 * kb's own media (DESIGN.md → Assets): files stored under `.kb/assets/` and
 * named by the path `asset.upload` answers with, `assets/<id>.<ext>`. What
 * kind of media a file is, by its extension, and whether a reference names
 * one of kb's assets, said once here for every place that stores, renders
 * or draws one: the upload's whitelist, markdown media, a canvas's
 * pictures.
 */

/** The kinds of media kb renders, in the order an extension is asked about. */
const MEDIA_KINDS = ["image", "video", "audio"] as const;
export type AssetMediaKind = (typeof MEDIA_KINDS)[number];

/** The extensions of each kind of media kb renders. */
export const MEDIA_EXTENSIONS: { readonly [K in AssetMediaKind]: ReadonlySet<string> } = {
  image: new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "avif", "bmp"]),
  video: new Set(["mp4", "webm", "mov", "ogv", "m4v"]),
  audio: new Set(["mp3", "wav", "ogg", "m4a", "aac", "flac", "opus"]),
};

/**
 * The media type of each extension kb stores an asset under: what the asset
 * route serves it as, and what a model is told a picture is. One map, so the
 * two never disagree.
 */
const ASSET_MEDIA_TYPES: Readonly<Record<string, string>> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  avif: "image/avif",
  bmp: "image/bmp",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  ogv: "video/ogg",
  m4v: "video/x-m4v",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  flac: "audio/flac",
  opus: "audio/opus",
  pdf: "application/pdf",
};

/** The media type a path names by its extension (case-blind); null for one kb has none for. */
export function assetMediaType(path: string): string | null {
  const ext = /\.([a-z0-9]{1,12})$/i.exec(path.trim())?.[1]?.toLowerCase();
  // `Object.hasOwn`, so an extension such as `.constructor` names nothing.
  return ext !== undefined && Object.hasOwn(ASSET_MEDIA_TYPES, ext)
    ? (ASSET_MEDIA_TYPES[ext] ?? null)
    : null;
}

/** The kind of media an extension (with or without its dot) is; null for one kb does not render. */
export function mediaKindFromExt(ext: string): AssetMediaKind | null {
  const e = ext.replace(/^\./, "").toLowerCase();
  return MEDIA_KINDS.find((kind) => MEDIA_EXTENSIONS[kind].has(e)) ?? null;
}

/** The kind of media a path or URL names, by the extension it ends with (before any query or fragment). */
export function mediaKindFromHref(href: string): AssetMediaKind | null {
  const ext = /\.([a-z0-9]{1,12})(?:$|[?#])/i.exec(href.trim())?.[1];
  return ext === undefined ? null : mediaKindFromExt(ext);
}

/**
 * Whether `href` names one of kb's own assets (`assets/…`): the only media
 * kb draws, so a document cannot make a viewer fetch from elsewhere.
 */
export function isAssetPath(href: string): boolean {
  return /^assets\/\S/i.test(href.trim());
}

/** Where kb serves one of its assets (`assets/…`): at the same path from its root. */
export function assetUrl(path: string): string {
  return `/${path.trim()}`;
}

/** One of kb's assets embedded in text as markdown media, `![alt](assets/…)`. */
export interface AssetEmbed {
  readonly alt: string;
  readonly path: string;
}

/** The asset embeds in text, in order: the one statement of what such an embed looks like. */
export function assetEmbedsOf(text: string): readonly AssetEmbed[] {
  return [...text.matchAll(/!\[([^\]]*)\]\((assets\/[^)\s]+)\)/gi)].map((m) => ({
    alt: m[1] ?? "",
    path: m[2] ?? "",
  }));
}

/** Whether text embeds one of kb's assets as markdown media, `![…](assets/…)`. */
export function textHasAssetRef(text: string): boolean {
  return assetEmbedsOf(text).length > 0;
}
