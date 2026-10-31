/**
 * One promise, every adapter: what the source marks as not for everyone
 * (mature, age-restricted, NSFW) is left out, every URL in a result is
 * https, every image a save would download, thumbnail too, is on a host the
 * adapter names, and its search URL is too. Each fixture holds one result
 * the adapter keeps beside ones it must leave out. Then each adapter's own
 * reading of its answer.
 */
import { describe, expect, test } from "bun:test";
import {
  SOURCE_ADAPTERS,
  civitaiAdapter,
  civitaiSized,
  openverseAdapter,
  polyHavenAdapter,
  queryWords,
  sketchfabAdapter,
  threeExamplesAdapter,
} from "../src/adapters.ts";
import {
  civitaiModels,
  openverseImages,
  polyHavenAssets,
  sketchfabModels,
  threeExamplesFiles,
} from "./fake-source.ts";

/** Each adapter's fixture: an answer, and the query it answers. */
const FIXTURES = new Map<string, { readonly answer: unknown; readonly query: string }>([
  [civitaiAdapter.kind, { answer: civitaiModels, query: "watercolor" }],
  [openverseAdapter.kind, { answer: openverseImages, query: "lighthouse" }],
  [sketchfabAdapter.kind, { answer: sketchfabModels, query: "pagoda" }],
  [polyHavenAdapter.kind, { answer: polyHavenAssets, query: "warm sunset" }],
  [threeExamplesAdapter.kind, { answer: threeExamplesFiles, query: "toon" }],
]);

describe("every source adapter", () => {
  for (const adapter of SOURCE_ADAPTERS) {
    const fixture = FIXTURES.get(adapter.kind);
    test(`${adapter.kind}: a fixture exists for it`, () => {
      expect(fixture).toBeDefined();
    });
    test(`${adapter.kind}: searches and downloads stay on its hosts, over https`, () => {
      const search = new URL(adapter.searchUrl("dolly zoom & co", "2"));
      expect(search.protocol).toBe("https:");
      expect(adapter.hosts(search.hostname)).toBe(true);
      if (fixture === undefined) return;
      for (const result of adapter.page(fixture.answer, fixture.query, undefined).results) {
        for (const url of [result.thumb, result.image, result.page])
          expect(new URL(url).protocol).toBe("https:");
        expect(adapter.hosts(new URL(result.image).hostname)).toBe(true);
        expect(adapter.hosts(new URL(result.thumb).hostname)).toBe(true);
      }
    });
    test(`${adapter.kind}: keeps only what it may show, each saying where it lives and its licence`, () => {
      if (fixture === undefined) return;
      const { results } = adapter.page(fixture.answer, fixture.query, undefined);
      expect(results.length).toBe(1);
      expect(results.every((r) => r.page !== "" && r.licence !== undefined)).toBe(true);
    });
    test(`${adapter.kind}: an answer of another shape reads as no results`, () => {
      expect(adapter.page({ nope: true }, "a", undefined).results).toEqual([]);
      expect(adapter.page(null, "a", undefined).results).toEqual([]);
    });
    test(`${adapter.kind}: a host it does not name is refused`, () => {
      expect(adapter.hosts("evil.example")).toBe(false);
    });
  }
});

describe("civitai", () => {
  test("a model's first PG image, resized by its path segment, with the model's terms", () => {
    const { results, next } = civitaiAdapter.page(civitaiModels, "watercolor", undefined);
    expect(next).toBe("2");
    expect(results[0]).toEqual({
      id: "civitai:749060:125103835",
      title: "Watercolor painting",
      thumb: "https://image.civitai.com/x/b/width=450/125103835.jpeg",
      image: "https://image.civitai.com/x/b/width=1024/125103835.jpeg",
      width: 832,
      height: 1216,
      page: "https://civitai.com/models/749060",
      creator: "Adel_AI",
      licence:
        "Civitai model licence: commercial use Image, RentCivit; credit not required; derivatives allowed",
    });
  });

  test("its search asks for safe models only, and pages by cursor", () => {
    const url = new URL(civitaiAdapter.searchUrl("watercolor", "abc"));
    expect(url.pathname).toBe("/api/v1/models");
    expect(url.searchParams.get("nsfw")).toBe("false");
    expect(url.searchParams.get("cursor")).toBe("abc");
    expect(civitaiSized("https://x/original=true/1.jpeg", 300)).toBe("https://x/width=300/1.jpeg");
  });
});

describe("openverse", () => {
  test("a work's proxied thumbnail, its landing page and its attribution", () => {
    const { results, next } = openverseAdapter.page(openverseImages, "lighthouse", undefined);
    expect(next).toBe("2");
    expect(results[0]).toEqual({
      id: "openverse:4bc43a04-ef46-4544-a0c1-63c63f56e276",
      title: "Lighthouse",
      thumb: "https://api.openverse.org/v1/images/4bc43a04-ef46-4544-a0c1-63c63f56e276/thumb/",
      image: "https://api.openverse.org/v1/images/4bc43a04-ef46-4544-a0c1-63c63f56e276/thumb/",
      width: 1024,
      height: 768,
      page: "https://www.flickr.com/photos/x/1",
      creator: "Jane",
      licence: '"Lighthouse" by Jane is licensed under CC BY 2.0.',
    });
  });

  test("a landing page that is not https gives way to the work's Openverse page", () => {
    const [work] = openverseImages.results;
    const answer = {
      results: [{ ...work, foreign_landing_url: "http://www.flickr.com/photos/x/1" }],
    };
    expect(openverseAdapter.page(answer, "lighthouse", undefined).results[0]?.page).toBe(
      "https://openverse.org/image/4bc43a04-ef46-4544-a0c1-63c63f56e276",
    );
  });

  test("its search asks for no mature works", () => {
    const url = new URL(openverseAdapter.searchUrl("lighthouse", undefined));
    expect(url.searchParams.get("mature")).toBe("false");
    expect(url.searchParams.has("page")).toBe(false);
  });
});

describe("sketchfab", () => {
  test("a downloadable, unrestricted model under a CC licence, its thumbnail and image sized", () => {
    const { results, next } = sketchfabAdapter.page(sketchfabModels, "pagoda", undefined);
    expect(next).toBe("24");
    expect(results).toEqual([
      {
        id: "sketchfab:134a80bc",
        title: "Low poly pagoda",
        thumb: "https://media.sketchfab.com/models/134a80bc/thumbnails/t/256.jpeg",
        image: "https://media.sketchfab.com/models/134a80bc/thumbnails/t/1024.jpeg",
        width: 1024,
        height: 576,
        page: "https://sketchfab.com/3d-models/low-poly-pagoda-134a80bc",
        creator: "Lan",
        licence: "CC Attribution, on Sketchfab",
      },
    ]);
  });

  test("its search asks for models, unrestricted and downloadable, and pages by cursor", () => {
    const url = new URL(sketchfabAdapter.searchUrl("pagoda", "24"));
    expect(url.pathname).toBe("/v3/search");
    expect(url.searchParams.get("restricted")).toBe("0");
    expect(url.searchParams.get("downloadable")).toBe("true");
    expect(url.searchParams.get("cursor")).toBe("24");
  });
});

describe("the catalogues", () => {
  test("a query's words are its own, lowercase, two letters or more", () => {
    expect(queryWords("Cel-shaded, toon ramp & a PS1 3D toon")).toEqual([
      "cel",
      "shaded",
      "toon",
      "ramp",
      "ps1",
      "3d",
    ]);
  });

  test("a query's word matches the start of an entry's word, not its middle", () => {
    const names = { webgl: ["webgl_toonish_ramp", "webgl_cartoon_ramp"] };
    expect(threeExamplesAdapter.page(names, "toon", undefined).results.map((r) => r.id)).toEqual([
      "threejs:webgl_toonish_ramp",
    ]);
  });

  test("Poly Haven: the assets the query's words name, the most words first, CC0", () => {
    const { results, next } = polyHavenAdapter.page(polyHavenAssets, "warm sunset bay", undefined);
    expect(next).toBeUndefined();
    expect(results).toEqual([
      {
        id: "polyhaven:golden_bay",
        title: "Golden Bay (HDRI)",
        thumb:
          "https://cdn.polyhaven.com/asset_img/thumbs/golden_bay.png?width=256&height=256&format=webp&v=1",
        image:
          "https://cdn.polyhaven.com/asset_img/thumbs/golden_bay.png?width=1024&height=1024&format=webp&v=1",
        page: "https://polyhaven.com/a/golden_bay",
        creator: "Greg Zaal",
        licence: "CC0, from Poly Haven",
      },
    ]);
    expect(polyHavenAdapter.page(polyHavenAssets, "zebra", undefined).results).toEqual([]);
  });

  test("three.js examples: the examples whose names hold the query's words, with their screenshots", () => {
    const { results } = threeExamplesAdapter.page(
      threeExamplesFiles,
      "pixel postprocessing",
      undefined,
    );
    expect(results.map((r) => r.id)).toEqual([
      "threejs:webgl_postprocessing_pixel",
      "threejs:webgl_postprocessing",
    ]);
    expect(results[0]?.thumb).toBe(
      "https://threejs.org/examples/screenshots/webgl_postprocessing_pixel.jpg",
    );
    expect(results[0]?.page).toBe("https://threejs.org/examples/#webgl_postprocessing_pixel");
  });

  const CATALOGUES = [
    {
      adapter: threeExamplesAdapter,
      many: { webgl: Array.from({ length: 45 }, (_, i) => `webgl_toon_${i}`) },
      id: (i: number) => `threejs:webgl_toon_${i}`,
    },
    {
      adapter: polyHavenAdapter,
      many: Object.fromEntries(
        Array.from({ length: 45 }, (_, i) => [
          `toon_${i}`,
          {
            name: `Toon ${i}`,
            type: 1,
            thumbnail_url: `https://cdn.polyhaven.com/asset_img/thumbs/toon_${i}.png`,
            download_count: 100 - i,
          },
        ]),
      ),
      id: (i: number) => `polyhaven:toon_${i}`,
    },
  ];
  for (const { adapter, many, id } of CATALOGUES)
    test(`${adapter.kind}: pages by offset, and asks for the same list whatever the query`, () => {
      const first = adapter.page(many, "toon", undefined);
      expect(first.results).toHaveLength(20);
      expect(first.next).toBe("20");
      const last = adapter.page(many, "toon", "40");
      expect(last.results.map((r) => r.id)).toEqual([40, 41, 42, 43, 44].map(id));
      expect(last.next).toBeUndefined();
      expect(adapter.searchUrl("a", "20")).toBe(adapter.searchUrl("b", undefined));
    });
});
