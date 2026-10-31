/**
 * A fake network for the gallery's adapters: a table of URL → response, and
 * a record of every request, so a test states what a source answers and
 * then what kb asked of it.
 */
import type { SourceFetch, SourceRequestInit } from "../src/http.ts";

export interface FakeAnswer {
  readonly status?: number;
  readonly headers?: Record<string, string>;
  readonly body?: string | Uint8Array;
}

export function fakeSource(answers: Record<string, FakeAnswer>): {
  readonly send: SourceFetch;
  readonly asked: Array<{ url: string; init: SourceRequestInit }>;
} {
  const asked: Array<{ url: string; init: SourceRequestInit }> = [];
  const send: SourceFetch = (url, init) => {
    asked.push({ url, init });
    const answer = answers[url];
    if (answer === undefined) return Promise.reject(new Error(`no fake answer for ${url}`));
    return Promise.resolve(
      new Response(answer.body ?? null, {
        status: answer.status ?? 200,
        headers: answer.headers ?? {},
      }),
    );
  };
  return { send, asked };
}

/** A Civitai `/models` answer: one PG model, one whose only image is above PG, one malformed. */
export const civitaiModels = {
  items: [
    {
      id: 749060,
      name: "Watercolor painting",
      type: "LORA",
      creator: { username: "Adel_AI" },
      allowCommercialUse: ["Image", "RentCivit"],
      allowNoCredit: true,
      allowDerivatives: true,
      modelVersions: [
        {
          images: [
            {
              id: 9,
              url: "https://image.civitai.com/x/a/original=true/9.jpeg",
              nsfwLevel: 4,
              width: 512,
              height: 512,
              type: "image",
            },
            {
              id: 125103835,
              url: "https://image.civitai.com/x/b/original=true/125103835.jpeg",
              nsfwLevel: 1,
              width: 832,
              height: 1216,
              type: "image",
            },
          ],
        },
      ],
    },
    {
      id: 2,
      name: "Only mature",
      creator: null,
      modelVersions: [
        {
          images: [
            { id: 3, url: "https://image.civitai.com/x/c/original=true/3.jpeg", nsfwLevel: 8 },
          ],
        },
      ],
    },
    { id: "not a model" },
  ],
  metadata: { nextCursor: "2" },
};

/** An Openverse `/v1/images/` answer: one work, one marked mature. */
export const openverseImages = {
  page: 1,
  page_count: 3,
  results: [
    {
      id: "4bc43a04-ef46-4544-a0c1-63c63f56e276",
      title: "Lighthouse",
      thumbnail: "https://api.openverse.org/v1/images/4bc43a04/thumb/",
      width: 1024,
      height: 768,
      foreign_landing_url: "https://www.flickr.com/photos/x/1",
      creator: "Jane",
      license: "by",
      license_version: "2.0",
      attribution: '"Lighthouse" by Jane is licensed under CC BY 2.0.',
      mature: false,
    },
    { id: "m", title: "mature", mature: true },
  ],
};

const sketchfabThumbs = (uid: string) => ({
  images: [1920, 1024, 720, 256, 64].map((width) => ({
    url: `https://media.sketchfab.com/models/${uid}/thumbnails/t/${width}.jpeg`,
    width,
    height: Math.round((width * 9) / 16),
  })),
});

/**
 * A Sketchfab `/v3/search` answer: one CC model, one age-restricted, one
 * under a store licence, one with no licence, and one malformed.
 */
export const sketchfabModels = {
  results: [
    {
      uid: "134a80bc",
      name: "Low poly pagoda",
      viewerUrl: "https://sketchfab.com/3d-models/low-poly-pagoda-134a80bc",
      isAgeRestricted: false,
      license: { label: "CC Attribution" },
      user: { username: "lan", displayName: "Lan" },
      thumbnails: sketchfabThumbs("134a80bc"),
    },
    {
      uid: "restricted",
      name: "Restricted",
      viewerUrl: "https://sketchfab.com/3d-models/restricted",
      isAgeRestricted: true,
      license: { label: "CC0 Public Domain" },
      thumbnails: sketchfabThumbs("restricted"),
    },
    {
      uid: "store",
      name: "Store model",
      viewerUrl: "https://sketchfab.com/3d-models/store",
      isAgeRestricted: false,
      license: { label: "Standard" },
      thumbnails: sketchfabThumbs("store"),
    },
    {
      uid: "unlicensed",
      name: "No licence",
      viewerUrl: "https://sketchfab.com/3d-models/unlicensed",
      isAgeRestricted: false,
      license: null,
      thumbnails: sketchfabThumbs("unlicensed"),
    },
    { uid: 3 },
  ],
  cursors: { next: "24", previous: null },
};

/** A Poly Haven `/assets` answer: an HDRI the query finds, a texture it does not, and one malformed. */
export const polyHavenAssets = {
  golden_bay: {
    name: "Golden Bay",
    type: 0,
    tags: ["sunset", "warm", "outdoor"],
    categories: ["outdoor", "skies"],
    description: "A low sun over a calm bay.",
    authors: { "Greg Zaal": "All" },
    thumbnail_url:
      "https://cdn.polyhaven.com/asset_img/thumbs/golden_bay.png?width=256&height=256&format=webp&v=1",
    download_count: 12,
  },
  aerial_asphalt_01: {
    name: "Aerial Asphalt 01",
    type: 1,
    tags: ["road", "flat"],
    categories: ["asphalt"],
    authors: { "Rob Tuytel": "All" },
    thumbnail_url: "https://cdn.polyhaven.com/asset_img/thumbs/aerial_asphalt_01.png?width=256",
    download_count: 148465,
  },
  broken: { name: 4 },
};

/** A three.js `examples/files.json` answer: categories of example names. */
export const threeExamplesFiles = {
  webgl: ["webgl_animation_keyframes", "webgl_materials_toon"],
  "webgl / postprocessing": ["webgl_postprocessing", "webgl_postprocessing_pixel"],
  "not names": ["../escape"],
};
