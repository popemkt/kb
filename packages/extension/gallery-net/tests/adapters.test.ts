/**
 * One promise, every adapter: results are PG only, every URL in a result is
 * https, every image a save would download is on a host the adapter names,
 * and its search URL is too. Then each adapter's own reading of its answer.
 */
import { describe, expect, test } from "bun:test";
import {
  SOURCE_ADAPTERS,
  civitaiAdapter,
  civitaiSized,
  openverseAdapter,
} from "../src/adapters.ts";
import { civitaiModels, openverseImages } from "./fake-source.ts";

/** Each adapter's fixture: an answer, and the query it answers. */
const FIXTURES = new Map<string, { readonly answer: unknown; readonly query: string }>([
  [civitaiAdapter.kind, { answer: civitaiModels, query: "watercolor" }],
  [openverseAdapter.kind, { answer: openverseImages, query: "lighthouse" }],
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
      }
    });
    test(`${adapter.kind}: results are PG only, and each says where it lives`, () => {
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
