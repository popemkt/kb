import { describe, expect, test } from "bun:test";
import { gunzipSync, brotliDecompressSync } from "node:zlib";
import { Effect, Option, Stream } from "effect";
import type { File } from "effect/FileSystem";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import { staticCacheHeaders } from "../src/assets.ts";
import { acceptedEncoding, deliver, matchesEtag } from "../src/delivery.ts";

const script = "export const answer = 42;\n".repeat(400);

function request(headers: Record<string, string> = {}, method = "GET"): Request {
  return new Request("http://kb.test/static/x.js", { method, headers });
}

function answer(
  body: string,
  headers: Record<string, string>,
  status = 200,
): HttpServerResponse.HttpServerResponse {
  return HttpServerResponse.raw(body, { status, headers });
}

const sent = (req: Request, res: HttpServerResponse.HttpServerResponse) =>
  Effect.runPromise(deliver(req, res));

function infoOf(size: number, mtime: Date): File.Info {
  // Only size and mtime name a file's version; the rest is what a stat says beside them.
  return { size, mtime: Option.some(mtime) } as unknown as File.Info;
}

describe("what the client accepts", () => {
  test("brotli before gzip, and an encoding refused with q=0 is not taken", () => {
    expect(acceptedEncoding("gzip, deflate, br, zstd")).toBe("br");
    expect(acceptedEncoding("gzip;q=1.0, br;q=0")).toBe("gzip");
    expect(acceptedEncoding("identity")).toBeNull();
    expect(acceptedEncoding(null)).toBeNull();
  });

  test("the coding weighed highest wins, and * stands for a coding left unnamed", () => {
    expect(acceptedEncoding("br;q=0.5, gzip;q=0.9")).toBe("gzip");
    expect(acceptedEncoding("gzip;q=0.5, br;q=0.5")).toBe("br");
    expect(acceptedEncoding("*")).toBe("br");
    expect(acceptedEncoding("gzip;q=0.8, *;q=0.1")).toBe("gzip");
    expect(acceptedEncoding("*;q=0")).toBeNull();
    expect(acceptedEncoding("br;q=junk, gzip")).toBe("gzip");
  });

  test("an If-None-Match names an ETag weakly, in a list, or as *", () => {
    expect(matchesEtag('W/"a-b"', 'W/"a-b"')).toBe(true);
    expect(matchesEtag('"x", "a-b"', 'W/"a-b"')).toBe(true);
    expect(matchesEtag("*", 'W/"a-b"')).toBe(true);
    expect(matchesEtag('"a-c"', 'W/"a-b"')).toBe(false);
    expect(matchesEtag(null, 'W/"a-b"')).toBe(false);
    expect(matchesEtag('"a-b"', null)).toBe(false);
  });
});

describe("how an answer is sent", () => {
  const js = { "content-type": "text/javascript;charset=utf-8" };

  test("text goes out in brotli or gzip, as accepted, and says it varies by what is accepted", async () => {
    const br = await sent(request({ "accept-encoding": "gzip, br" }), answer(script, js));
    expect(br.headers.get("content-encoding")).toBe("br");
    expect(br.headers.get("vary")).toBe("Accept-Encoding");
    const brBytes = new Uint8Array(await br.arrayBuffer());
    expect(brBytes.length).toBeLessThan(script.length / 10);
    expect(new TextDecoder().decode(brotliDecompressSync(brBytes))).toBe(script);

    const gz = await sent(request({ "accept-encoding": "gzip" }), answer(script, js));
    expect(gz.headers.get("content-encoding")).toBe("gzip");
    const gzBytes = new Uint8Array(await gz.arrayBuffer());
    expect(new TextDecoder().decode(gunzipSync(gzBytes))).toBe(script);
  });

  test("a client that accepts no encoding, a small body, and media go out as they are", async () => {
    const plain = await sent(request(), answer(script, js));
    expect(plain.headers.get("content-encoding")).toBeNull();
    expect(plain.headers.get("vary")).toBe("Accept-Encoding");
    expect(await plain.text()).toBe(script);

    const small = await sent(request({ "accept-encoding": "br" }), answer("{}", js));
    expect(small.headers.get("content-encoding")).toBeNull();
    expect(await small.text()).toBe("{}");

    const png = await sent(
      request({ "accept-encoding": "br" }),
      answer(script, { "content-type": "image/png" }),
    );
    expect(png.headers.get("content-encoding")).toBeNull();
    expect(png.headers.get("vary")).toBeNull();
  });

  test("a revalidation of the bytes the client holds is a 304 that keeps the caching headers", async () => {
    const headers = {
      ...js,
      etag: 'W/"1-2"',
      "cache-control": "no-cache",
      "content-security-policy": "frame-ancestors 'self'",
    };
    const res = await sent(
      request({ "if-none-match": 'W/"1-2"', "accept-encoding": "br" }),
      answer(script, headers),
    );
    expect(res.status).toBe(304);
    expect(await res.text()).toBe("");
    expect(res.headers.get("etag")).toBe('W/"1-2"');
    expect(res.headers.get("vary")).toBe("Accept-Encoding");
    expect(res.headers.get("cache-control")).toBe("no-cache");
    expect(res.headers.get("content-security-policy")).toBe("frame-ancestors 'self'");

    const changed = await sent(request({ "if-none-match": 'W/"1-1"' }), answer(script, headers));
    expect(changed.status).toBe(200);
  });

  test("an answer that is not a 200 is sent untouched", async () => {
    const failed = await sent(request({ "accept-encoding": "br" }), answer(script, js, 500));
    expect(failed.status).toBe(500);
    expect(failed.headers.get("content-encoding")).toBeNull();
    expect(await failed.text()).toBe(script);
  });

  test("a streamed body and an event stream go as they are written, never gathered to be encoded", async () => {
    const streamed = HttpServerResponse.stream(Stream.make(new TextEncoder().encode(script)), {
      contentType: "text/javascript",
    });
    const sentStream = await sent(request({ "accept-encoding": "br" }), streamed);
    expect(sentStream.headers.get("content-encoding")).toBeNull();
    expect(await sentStream.text()).toBe(script);

    const events = await sent(
      request({ "accept-encoding": "br" }),
      answer(script, { "content-type": "text/event-stream" }),
    );
    expect(events.headers.get("content-encoding")).toBeNull();
    expect(events.headers.get("vary")).toBeNull();
  });

  test("a body the client cannot keep is encoded afresh, and decodes to the same bytes", async () => {
    const json = { "content-type": "application/json;charset=utf-8" };
    const first = await sent(request({ "accept-encoding": "br" }), answer(script, json));
    expect(first.headers.get("content-encoding")).toBe("br");
    const bytes = new Uint8Array(await first.arrayBuffer());
    expect(new TextDecoder().decode(brotliDecompressSync(bytes))).toBe(script);
  });

  test("a receipt to a POST is encoded too, but a POST is never answered 304", async () => {
    const headers = { "content-type": "application/json;charset=utf-8", etag: 'W/"1-2"' };
    const posted = await sent(
      request({ "accept-encoding": "br", "if-none-match": 'W/"1-2"' }, "POST"),
      answer(script, headers),
    );
    expect(posted.status).toBe(200);
    expect(posted.headers.get("content-encoding")).toBe("br");
  });
});

describe("how long a ui/dist file is kept", () => {
  const info = infoOf(4793, new Date("2026-10-25T00:00:00Z"));

  test("the bundler's digest-named output for good, with no revalidation", () => {
    expect(staticCacheHeaders("static/index-DH68F8UN.js", info)).toEqual({
      "Cache-Control": "public, max-age=31536000, immutable",
    });
  });

  test("index.html and the public files only after asking, by a version the file's stat names", () => {
    const html = staticCacheHeaders("index.html", info);
    expect(html["Cache-Control"]).toBe("no-cache");
    expect(html.ETag).toMatch(/^W\/"[0-9a-z]+-[0-9a-z]+"$/);
    expect(staticCacheHeaders("favicon.svg", info).ETag).toBe(html.ETag);
    const touched = infoOf(4793, new Date("2026-10-25T00:00:01Z"));
    expect(staticCacheHeaders("index.html", touched).ETag).not.toBe(html.ETag);
  });
});
