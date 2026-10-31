/**
 * The source adapters: one per API kind a source node can name, each a
 * search URL, a reading of the answer into the one result shape, and the
 * hosts it may reach. Every adapter meets the same promise (the contract
 * suite in `tests/adapters.test.ts` runs over {@link SOURCE_ADAPTERS}):
 * results are PG only, carry a page to open and a credit, and never point
 * a download or a thumbnail at a host the adapter does not name. The search
 * holds every adapter's results to that (`admitted`, `actions.ts`).
 *
 * What each source allows, and why these, is the research record's §3 and
 * the 3D record's (docs/research/2026-10-31-3d-styles-and-sources.md).
 */
import { z } from "zod";
import { GALLERY_IDS, type SourceResult } from "@kb/gallery";

export interface SearchPage {
  readonly results: readonly SourceResult[];
  readonly next?: string;
}

export interface SourceAdapter {
  /** The source-kind option node it serves. */
  readonly kind: string;
  /** Whether a search or a download may reach `host`. */
  readonly hosts: (host: string) => boolean;
  readonly searchUrl: (query: string, cursor: string | undefined) => string;
  /**
   * The answer to `searchUrl(query, cursor)` read into results; an answer of
   * another shape reads as none. A source that searches answers only what
   * matches, and its reading ignores the query; a source that publishes a
   * catalogue answers all of it, and its reading is the search.
   */
  readonly page: (answer: unknown, query: string, cursor: string | undefined) => SearchPage;
}

const PAGE_SIZE = 20;

// ─── Civitai ────────────────────────────────────────────────────────────────

const CivitaiImage = z.object({
  id: z.number(),
  url: z.string(),
  width: z.number().optional(),
  height: z.number().optional(),
  nsfwLevel: z.number().optional(),
  type: z.string().optional(),
});
const CivitaiModel = z.object({
  id: z.number(),
  name: z.string(),
  creator: z.object({ username: z.string().nullable().optional() }).nullable().optional(),
  allowCommercialUse: z.union([z.array(z.string()), z.string()]).optional(),
  allowNoCredit: z.boolean().optional(),
  allowDerivatives: z.boolean().optional(),
  modelVersions: z.array(z.object({ images: z.array(z.unknown()).optional() })).optional(),
});
const CivitaiAnswer = z.object({
  items: z.array(z.unknown()),
  metadata: z.object({ nextCursor: z.union([z.string(), z.number()]).optional() }).optional(),
});

/** Civitai's PG level (`NsfwLevel.PG = 1`); nothing above it is shown. */
const CIVITAI_PG = 1;

/** A Civitai image URL resized by its path segment (`original=true` → `width=<w>`). */
export function civitaiSized(url: string, width: number): string {
  return url.replace(/\/original=true\//, `/width=${width}/`);
}

function civitaiLicence(model: z.infer<typeof CivitaiModel>): string {
  const use = model.allowCommercialUse;
  const commercial = Array.isArray(use) ? use.join(", ") : (use ?? "");
  return [
    `Civitai model licence: commercial use ${commercial === "" ? "none" : commercial}`,
    model.allowNoCredit === false ? "credit required" : "credit not required",
    model.allowDerivatives === false ? "no derivatives" : "derivatives allowed",
  ].join("; ");
}

export const civitaiAdapter: SourceAdapter = {
  kind: GALLERY_IDS.kindCivitai,
  hosts: (host) => host === "civitai.com" || host.endsWith(".civitai.com"),
  searchUrl: (query, cursor) => {
    const params = new URLSearchParams({ query, limit: String(PAGE_SIZE), nsfw: "false" });
    if (cursor !== undefined) params.set("cursor", cursor);
    return `https://civitai.com/api/v1/models?${params.toString()}`;
  },
  page: (answer) => {
    const parsed = CivitaiAnswer.safeParse(answer);
    if (!parsed.success) return { results: [] };
    const results: SourceResult[] = [];
    for (const item of parsed.data.items) {
      const model = CivitaiModel.safeParse(item);
      if (!model.success) continue;
      const images = (model.data.modelVersions?.[0]?.images ?? []).flatMap((raw) => {
        const image = CivitaiImage.safeParse(raw);
        return image.success ? [image.data] : [];
      });
      const image = images.find(
        (i) => i.nsfwLevel === CIVITAI_PG && (i.type ?? "image") === "image",
      );
      if (image === undefined) continue;
      const creator = model.data.creator?.username;
      results.push({
        id: `civitai:${model.data.id}:${image.id}`,
        title: model.data.name,
        thumb: civitaiSized(image.url, 450),
        image: civitaiSized(image.url, 1024),
        ...(image.width === undefined ? {} : { width: image.width }),
        ...(image.height === undefined ? {} : { height: image.height }),
        page: `https://civitai.com/models/${model.data.id}`,
        ...(creator === undefined || creator === null ? {} : { creator }),
        licence: civitaiLicence(model.data),
      });
    }
    const next = parsed.data.metadata?.nextCursor;
    return next === undefined ? { results } : { results, next: String(next) };
  },
};

// ─── Openverse ──────────────────────────────────────────────────────────────

const OpenverseImage = z.object({
  id: z.string(),
  title: z.string().nullable().optional(),
  thumbnail: z.string().nullable().optional(),
  width: z.number().nullable().optional(),
  height: z.number().nullable().optional(),
  foreign_landing_url: z.string().nullable().optional(),
  creator: z.string().nullable().optional(),
  license: z.string().nullable().optional(),
  license_version: z.string().nullable().optional(),
  attribution: z.string().nullable().optional(),
  mature: z.boolean().optional(),
});
const OpenverseAnswer = z.object({
  results: z.array(z.unknown()),
  page: z.number().optional(),
  page_count: z.number().optional(),
});

const OPENVERSE_API = "https://api.openverse.org";

/**
 * One Openverse work as a result: its proxied thumbnail, its page and its
 * terms. Its page is where the work lives when that is https, else its
 * Openverse page: a provider's landing page is often plain http.
 */
function openverseResult(image: z.infer<typeof OpenverseImage>): SourceResult {
  const { id, title, width, height, creator, license, license_version, attribution } = image;
  const thumb = `${OPENVERSE_API}/v1/images/${encodeURIComponent(id)}/thumb/`;
  const licence =
    attribution ??
    (license === null || license === undefined
      ? undefined
      : `${license.toUpperCase()} ${license_version ?? ""}`.trim());
  return {
    id: `openverse:${id}`,
    title: title ?? "Untitled",
    thumb,
    image: thumb,
    ...(width === null || width === undefined ? {} : { width }),
    ...(height === null || height === undefined ? {} : { height }),
    page:
      image.foreign_landing_url?.startsWith("https://") === true
        ? image.foreign_landing_url
        : `https://openverse.org/image/${encodeURIComponent(id)}`,
    ...(creator === null || creator === undefined ? {} : { creator }),
    ...(licence === undefined ? {} : { licence }),
  };
}

export const openverseAdapter: SourceAdapter = {
  kind: GALLERY_IDS.kindOpenverse,
  // Openverse proxies every thumbnail, so a save never reaches a provider's host.
  hosts: (host) => host === "api.openverse.org",
  searchUrl: (query, cursor) => {
    const params = new URLSearchParams({ q: query, page_size: String(PAGE_SIZE), mature: "false" });
    if (cursor !== undefined) params.set("page", cursor);
    return `${OPENVERSE_API}/v1/images/?${params.toString()}`;
  },
  page: (answer) => {
    const parsed = OpenverseAnswer.safeParse(answer);
    if (!parsed.success) return { results: [] };
    const results: SourceResult[] = [];
    for (const item of parsed.data.results) {
      const image = OpenverseImage.safeParse(item);
      if (!image.success || image.data.mature === true) continue;
      results.push(openverseResult(image.data));
    }
    const page = parsed.data.page ?? 1;
    const count = parsed.data.page_count ?? page;
    return page < count ? { results, next: String(page + 1) } : { results };
  },
};

// ─── Sketchfab ──────────────────────────────────────────────────────────────

const SketchfabThumb = z.object({ url: z.string(), width: z.number(), height: z.number() });
const SketchfabModel = z.object({
  uid: z.string(),
  name: z.string(),
  viewerUrl: z.string(),
  isAgeRestricted: z.boolean(),
  license: z.object({ label: z.string() }).nullable().optional(),
  user: z
    .object({ displayName: z.string().nullable().optional(), username: z.string() })
    .nullable()
    .optional(),
  thumbnails: z
    .object({ images: z.array(SketchfabThumb) })
    .nullable()
    .optional(),
});
const SketchfabAnswer = z.object({
  results: z.array(z.unknown()),
  cursors: z.object({ next: z.string().nullable().optional() }).optional(),
});

/** The smallest of `images` at least `width` wide, else the largest. */
function sizedAtLeast<T extends { readonly width: number }>(
  images: readonly T[],
  width: number,
): T | undefined {
  const sorted = images.toSorted((a, b) => a.width - b.width);
  return sorted.find((image) => image.width >= width) ?? sorted.at(-1);
}

/**
 * Sketchfab's Data API search: models only, never age-restricted, and only
 * those a person may download, which are the ones under a Creative Commons
 * licence; a result whose licence is not Creative Commons is dropped.
 */
export const sketchfabAdapter: SourceAdapter = {
  kind: GALLERY_IDS.kindSketchfab,
  hosts: (host) => host === "api.sketchfab.com" || host === "media.sketchfab.com",
  searchUrl: (query, cursor) => {
    const params = new URLSearchParams({
      type: "models",
      q: query,
      restricted: "0",
      downloadable: "true",
      count: "24",
    });
    if (cursor !== undefined) params.set("cursor", cursor);
    return `https://api.sketchfab.com/v3/search?${params.toString()}`;
  },
  page: (answer) => {
    const parsed = SketchfabAnswer.safeParse(answer);
    if (!parsed.success) return { results: [] };
    const results: SourceResult[] = [];
    for (const item of parsed.data.results) {
      const model = SketchfabModel.safeParse(item);
      if (!model.success || model.data.isAgeRestricted) continue;
      const licence = model.data.license?.label ?? "";
      if (!licence.startsWith("CC")) continue;
      const images = model.data.thumbnails?.images ?? [];
      const thumb = sizedAtLeast(images, 256);
      const image = sizedAtLeast(images, 1024);
      if (thumb === undefined || image === undefined) continue;
      const user = model.data.user;
      const creator =
        user === null || user === undefined ? undefined : (user.displayName ?? user.username);
      results.push({
        id: `sketchfab:${model.data.uid}`,
        title: model.data.name,
        thumb: thumb.url,
        image: image.url,
        width: image.width,
        height: image.height,
        page: model.data.viewerUrl,
        ...(creator === undefined ? {} : { creator }),
        licence: `${licence}, on Sketchfab`,
      });
    }
    const next = parsed.data.cursors?.next;
    return next === null || next === undefined ? { results } : { results, next };
  },
};

// ─── Catalogues: Poly Haven, three.js examples ─────────────────────────────

/** The words of a query a catalogue entry is matched by: lowercase, three letters or more. */
export function queryWords(query: string): readonly string[] {
  return [...new Set(query.toLowerCase().split(/[^\p{L}\p{N}]+/u))].filter(
    (word) => word.length >= 3,
  );
}

/**
 * One page of a catalogue read for a query: each entry scored by how many
 * of the query's words its text holds, the best first (ties keep the
 * catalogue's order), `PAGE_SIZE` from the offset `cursor` names.
 */
function catalogPage<T>(
  entries: readonly T[],
  textOf: (entry: T) => string,
  query: string,
  cursor: string | undefined,
  resultOf: (entry: T) => SourceResult,
): SearchPage {
  const words = queryWords(query);
  const scored = entries
    .map((entry) => {
      const text = textOf(entry).toLowerCase();
      return { entry, score: words.filter((word) => text.includes(word)).length };
    })
    .filter(({ score }) => score > 0)
    .toSorted((a, b) => b.score - a.score);
  const from = Math.max(0, Number.parseInt(cursor ?? "0", 10) || 0);
  const results = scored.slice(from, from + PAGE_SIZE).map(({ entry }) => resultOf(entry));
  return from + PAGE_SIZE < scored.length
    ? { results, next: String(from + PAGE_SIZE) }
    : { results };
}

const PolyHavenAsset = z.object({
  name: z.string(),
  type: z.number(),
  tags: z.array(z.string()).optional(),
  categories: z.array(z.string()).optional(),
  category: z.string().optional(),
  description: z.string().optional(),
  authors: z.record(z.string(), z.string()).optional(),
  thumbnail_url: z.string(),
  download_count: z.number().optional(),
});
type PolyHavenAsset = z.infer<typeof PolyHavenAsset> & { readonly id: string };

const POLY_HAVEN_TYPES = ["HDRI", "texture", "model"] as const;

/** A Poly Haven thumbnail at `size` px square: the CDN sizes it by its query. */
function polyHavenSized(url: string, size: number): string {
  const sized = new URL(url);
  sized.searchParams.set("width", String(size));
  sized.searchParams.set("height", String(size));
  return sized.href;
}

/**
 * Poly Haven: CC0 HDRIs, textures and models. Its API has no text search,
 * so the search reads its published catalogue for the query, by name, tags,
 * categories and description. Its terms ask for a client of its own name
 * (the user agent every request carries, `./http.ts`) and a visible credit,
 * which the source's name in the panel is.
 */
export const polyHavenAdapter: SourceAdapter = {
  kind: GALLERY_IDS.kindPolyHaven,
  hosts: (host) => host === "api.polyhaven.com" || host === "cdn.polyhaven.com",
  searchUrl: () => "https://api.polyhaven.com/assets?type=all",
  page: (answer, query, cursor) => {
    if (typeof answer !== "object" || answer === null || Array.isArray(answer))
      return { results: [] };
    const assets: PolyHavenAsset[] = [];
    for (const [id, raw] of Object.entries(answer)) {
      const asset = PolyHavenAsset.safeParse(raw);
      if (asset.success) assets.push({ ...asset.data, id });
    }
    assets.sort((a, b) => (b.download_count ?? 0) - (a.download_count ?? 0));
    return catalogPage(
      assets,
      (asset) =>
        [
          asset.name,
          ...(asset.tags ?? []),
          ...(asset.categories ?? []),
          asset.category,
          asset.description,
        ].join(" "),
      query,
      cursor,
      (asset) => {
        const authors = Object.keys(asset.authors ?? {});
        const kind = POLY_HAVEN_TYPES[asset.type] ?? "asset";
        return {
          id: `polyhaven:${asset.id}`,
          title: `${asset.name} (${kind})`,
          thumb: polyHavenSized(asset.thumbnail_url, 256),
          image: polyHavenSized(asset.thumbnail_url, 1024),
          width: 1024,
          height: 1024,
          page: `https://polyhaven.com/a/${encodeURIComponent(asset.id)}`,
          ...(authors.length === 0 ? {} : { creator: authors.join(", ") }),
          licence: "CC0, from Poly Haven",
        };
      },
    );
  },
};

const ThreeExamplesAnswer = z.record(z.string(), z.array(z.string()));

/**
 * The three.js examples: every technique demo the library ships, read from
 * its published list for the query by the words of each example's name
 * (`webgl_postprocessing_pixel`), shown with its own screenshot. The
 * examples are MIT, as three.js is.
 */
export const threeExamplesAdapter: SourceAdapter = {
  kind: GALLERY_IDS.kindThreeExamples,
  hosts: (host) => host === "threejs.org",
  searchUrl: () => "https://threejs.org/examples/files.json",
  page: (answer, query, cursor) => {
    const parsed = ThreeExamplesAnswer.safeParse(answer);
    if (!parsed.success) return { results: [] };
    const names = [...new Set(Object.values(parsed.data).flat())].filter((name) =>
      /^[a-z0-9_]+$/.test(name),
    );
    return catalogPage(
      names,
      (name) => name.replaceAll("_", " "),
      query,
      cursor,
      (name) => ({
        id: `threejs:${name}`,
        title: name.replaceAll("_", " "),
        thumb: `https://threejs.org/examples/screenshots/${name}.jpg`,
        image: `https://threejs.org/examples/screenshots/${name}.jpg`,
        page: `https://threejs.org/examples/#${name}`,
        creator: "three.js authors",
        licence: "MIT, three.js examples",
      }),
    );
  },
};

/** Every API adapter, by the source-kind option it serves. */
export const SOURCE_ADAPTERS: readonly SourceAdapter[] = [
  civitaiAdapter,
  openverseAdapter,
  sketchfabAdapter,
  polyHavenAdapter,
  threeExamplesAdapter,
];
