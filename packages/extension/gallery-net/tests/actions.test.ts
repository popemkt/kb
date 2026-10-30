/**
 * The handlers against a fake network and a fake core: a search reads the
 * source node and asks its adapter; a link source is refused; a save
 * downloads within the adapter's hosts and writes only through
 * `asset.upload` and `node.add`; the network posture holds (https only,
 * bounded redirects, bounded bodies).
 */
import { describe, expect, test } from "bun:test";
import { Effect, Exit } from "effect";
import { CoreInvoke, KbCtx, type ActionRequest, type ActionReceipt } from "@kb/contracts";
import { SYSTEM_IDS, extensionNodeId, type KbNode } from "@kb/model";
import { GALLERY_IDS, GALLERY_SOURCE_IDS, starterOutline, type SourceResult } from "@kb/gallery";
import { base64Of, saveEffect, searchEffect, starterEffect, visualProps } from "../src/actions.ts";
import { boundedBytes, getFrom } from "../src/http.ts";
import { civitaiModels, fakeSource } from "./fake-source.ts";

const AT = "2026-01-01T00:00:00.000Z";
const node = (id: string, text: string, props: KbNode["props"]): KbNode => ({
  id,
  text,
  props,
  children: [],
  createdAt: AT,
  updatedAt: AT,
});
const source = (id: string, kind: string) =>
  node(id, id, {
    [SYSTEM_IDS.typeField]: [{ t: "ref", v: GALLERY_IDS.sourceTag }],
    [GALLERY_IDS.sourceKindField]: [{ t: "ref", v: kind }],
  });
const graph = new Map<string, KbNode>(
  [
    source(GALLERY_SOURCE_IDS.civitai, GALLERY_IDS.kindCivitai),
    source(GALLERY_SOURCE_IDS.pinterest, GALLERY_IDS.kindLink),
    node(extensionNodeId("gallery"), "gallery", {
      [GALLERY_IDS.saveIntoField]: [{ t: "ref", v: "library" }],
    }),
  ].map((n) => [n.id, n]),
);
// The handlers read the session through `index.getNode` only.
const ctx = { index: { getNode: (id: string) => graph.get(id) } } as unknown as KbCtx["Service"];

function run<A, E>(effect: Effect.Effect<A, E, KbCtx>, calls: ActionRequest[] = []) {
  const invoke = (request: ActionRequest): Effect.Effect<ActionReceipt> => {
    calls.push(request);
    const output = OUTPUTS[request.id] ?? { id: "01NEW" };
    const receipt: ActionReceipt = { status: "succeeded", id: request.id, output };
    return Effect.succeed(receipt);
  };
  return Effect.runPromiseExit(
    effect.pipe(Effect.provideService(KbCtx, ctx), Effect.provideService(CoreInvoke, invoke)),
  );
}

const STARTER_LINES = starterOutline().split("\n").length;
const OUTPUTS: Record<string, unknown> = {
  "asset.upload": { path: "assets/01X.jpg" },
  "node.addTree": {
    ids: ["01STYLES", "01LIB"],
    lines: { "1": "01STYLES", [STARTER_LINES]: "01LIB" },
  },
};

const SEARCH = "https://civitai.com/api/v1/models?query=watercolor&limit=20&nsfw=false";

describe("ext.gallery.search", () => {
  test("asks the source's adapter and answers its results", async () => {
    const net = fakeSource({ [SEARCH]: { body: JSON.stringify(civitaiModels) } });
    const exit = await run(
      searchEffect(net.send)({ source: GALLERY_SOURCE_IDS.civitai, query: " watercolor " }),
    );
    expect(Exit.isSuccess(exit) && exit.value.results.length).toBe(1);
    expect(net.asked.map((a) => a.url)).toEqual([SEARCH]);
    expect(net.asked[0]?.init.redirect).toBe("manual");
  });

  test("a result whose image or thumbnail is off the adapter's hosts, or whose page is not https, is dropped", async () => {
    const [model] = civitaiModels.items;
    const image = (url: string) => ({
      ...model,
      modelVersions: [{ images: [{ id: 1, url, nsfwLevel: 1, type: "image" }] }],
    });
    const answer = {
      items: [
        image("https://image.civitai.com/x/b/original=true/1.jpeg"),
        image("https://tracker.example/original=true/1.jpeg"),
        image("http://image.civitai.com/x/b/original=true/1.jpeg"),
      ],
    };
    const net = fakeSource({ [SEARCH]: { body: JSON.stringify(answer) } });
    const exit = await run(
      searchEffect(net.send)({ source: GALLERY_SOURCE_IDS.civitai, query: "watercolor" }),
    );
    expect(Exit.isSuccess(exit) && exit.value.results.map((r) => r.thumb)).toEqual([
      "https://image.civitai.com/x/b/width=450/1.jpeg",
    ]);
  });

  test("a link source is the page's to open, never called", async () => {
    const net = fakeSource({});
    const exit = await run(
      searchEffect(net.send)({ source: GALLERY_SOURCE_IDS.pinterest, query: "x" }),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    expect(net.asked).toEqual([]);
  });

  test("a node that is not a source is not found", async () => {
    const exit = await run(searchEffect(fakeSource({}).send)({ source: "nope", query: "x" }));
    expect(Exit.isFailure(exit)).toBe(true);
  });
});

const RESULT: SourceResult = {
  id: "civitai:1:2",
  title: "Watercolor [test]",
  thumb: "https://image.civitai.com/x/width=450/2.jpeg",
  image: "https://image.civitai.com/x/width=1024/2.jpeg",
  width: 832,
  height: 1216,
  page: "https://civitai.com/models/1",
  creator: "Adel_AI",
  licence: "credit not required",
};

describe("ext.gallery.save", () => {
  test("downloads through a redirect on the adapter's hosts, then uploads and adds", async () => {
    const blob = "https://blobs-b2.civitai.com/file/2.jpeg";
    const net = fakeSource({
      [RESULT.image]: { status: 301, headers: { location: blob } },
      [blob]: { headers: { "content-type": "image/jpeg" }, body: new Uint8Array([1, 2, 3]) },
    });
    const calls: ActionRequest[] = [];
    const exit = await run(
      saveEffect(net.send)({ source: GALLERY_SOURCE_IDS.civitai, result: RESULT }),
      calls,
    );
    expect(Exit.isSuccess(exit) && exit.value).toEqual({ id: "01NEW", asset: "assets/01X.jpg" });
    expect(calls.map((c) => c.id)).toEqual(["asset.upload", "node.add"]);
    expect(calls[0]?.input).toEqual({
      bytes: base64Of(new Uint8Array([1, 2, 3])),
      encoding: "base64",
      ext: "jpg",
    });
    expect(calls[1]?.input).toMatchObject({
      text: RESULT.title,
      tags: [GALLERY_IDS.visualTag],
      parent: "library",
    });
  });

  test("a redirect off the adapter's hosts is refused, and nothing is written", async () => {
    const net = fakeSource({
      [RESULT.image]: { status: 302, headers: { location: "https://evil.example/x.jpeg" } },
    });
    const calls: ActionRequest[] = [];
    const exit = await run(
      saveEffect(net.send)({ source: GALLERY_SOURCE_IDS.civitai, result: RESULT }),
      calls,
    );
    expect(Exit.isFailure(exit)).toBe(true);
    expect(calls).toEqual([]);
  });

  test("a result a search would not admit is refused before anything is fetched or written", async () => {
    for (const result of [
      { ...RESULT, page: "javascript:alert(1)" },
      { ...RESULT, page: "http://civitai.com/models/1" },
      { ...RESULT, thumb: "https://tracker.example/pixel.gif" },
    ]) {
      const net = fakeSource({});
      const calls: ActionRequest[] = [];
      const exit = await run(
        saveEffect(net.send)({ source: GALLERY_SOURCE_IDS.civitai, result }),
        calls,
      );
      expect(Exit.isFailure(exit)).toBe(true);
      expect(net.asked).toEqual([]);
      expect(calls).toEqual([]);
    }
  });

  test("a body that is not an image is refused", async () => {
    const net = fakeSource({
      [RESULT.image]: { headers: { "content-type": "text/html" }, body: "<html>" },
    });
    const exit = await run(
      saveEffect(net.send)({ source: GALLERY_SOURCE_IDS.civitai, result: RESULT }),
    );
    expect(Exit.isFailure(exit)).toBe(true);
  });

  test("the visual carries its media, page, credit and size; brackets never break the embed", () => {
    const props = visualProps(RESULT, "assets/01X.jpg");
    expect(props.map((p) => [p.field, p.value.v])).toEqual([
      [GALLERY_IDS.mediaField, "![Watercolor test](assets/01X.jpg)"],
      [GALLERY_IDS.sourceField, RESULT.page],
      [GALLERY_IDS.creditField, "by Adel_AI · credit not required"],
      [GALLERY_IDS.widthField, 832],
      [GALLERY_IDS.heightField, 1216],
    ]);
  });
});

const all = () => true;
const hop = (n: number) => `https://a.test/${n}`;
describe("ext.gallery.starter", () => {
  test("pastes the starter, then names its Library where saves go, on the server's ids", async () => {
    const calls: ActionRequest[] = [];
    const exit = await run(starterEffect(), calls);
    expect(Exit.isSuccess(exit) && exit.value).toEqual({
      library: "01LIB",
      ids: ["01STYLES", "01LIB"],
    });
    expect(calls.map((c) => c.id)).toEqual(["node.addTree", "node.update"]);
    expect(calls[0]?.input).toEqual({ outline: starterOutline() });
    expect(calls[1]?.input).toEqual({
      id: extensionNodeId("gallery"),
      setProps: [{ field: GALLERY_IDS.saveIntoField, value: { t: "ref", v: "01LIB" } }],
    });
  });
});

describe("the network posture", () => {
  test("plain http is never sent", async () => {
    const net = fakeSource({});
    const exit = await Effect.runPromiseExit(
      Effect.scoped(getFrom(net.send, "http://civitai.com/x", all, "*/*")),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    expect(net.asked).toEqual([]);
  });

  test("a third redirect is refused", async () => {
    const net = fakeSource({
      [hop(0)]: { status: 302, headers: { location: hop(1) } },
      [hop(1)]: { status: 302, headers: { location: hop(2) } },
      [hop(2)]: { status: 302, headers: { location: hop(3) } },
      [hop(3)]: { body: "x" },
    });
    const exit = await Effect.runPromiseExit(Effect.scoped(getFrom(net.send, hop(0), all, "*/*")));
    expect(Exit.isFailure(exit)).toBe(true);
    expect(net.asked.length).toBe(3);
  });

  test("a body over its bound fails instead of being held", async () => {
    const exit = await Effect.runPromiseExit(boundedBytes(new Response("x".repeat(100)), 10));
    expect(Exit.isFailure(exit)).toBe(true);
    const ok = await Effect.runPromiseExit(boundedBytes(new Response("abc"), 10));
    expect(Exit.isSuccess(ok) && new TextDecoder().decode(ok.value)).toBe("abc");
  });
});
