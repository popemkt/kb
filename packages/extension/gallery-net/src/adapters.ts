/**
 * The source adapters: one per API kind a source node can name, each a
 * search URL, a reading of the answer into the one result shape, and the
 * hosts it may reach. Every adapter meets the same promise (the contract
 * suite in `tests/adapters.test.ts` runs over {@link SOURCE_ADAPTERS}):
 * results are PG only, carry a page to open and a credit, and never point
 * a download at a host the adapter does not name.
 *
 * What each source allows, and why these two, is the research record's §3.
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
  /** The answer read into results; an answer of another shape reads as none. */
  readonly page: (answer: unknown) => SearchPage;
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

/** One Openverse work as a result: its proxied thumbnail, its page and its terms. */
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
    page: image.foreign_landing_url ?? `https://openverse.org/image/${id}`,
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

/** Every API adapter, by the source-kind option it serves. */
export const SOURCE_ADAPTERS: readonly SourceAdapter[] = [civitaiAdapter, openverseAdapter];
