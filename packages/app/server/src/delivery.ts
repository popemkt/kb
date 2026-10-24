/**
 * How an HTTP answer travels to the client (DESIGN-UI.md → Delivery): a
 * revalidation of bytes the client already holds is answered `304`, and a
 * text body goes out in the best encoding the client accepts. This is the
 * one place either happens; a route says only what it answers and how long
 * it may be kept (`Cache-Control`, `ETag`), never how it is sent.
 */
import { createHash } from "node:crypto";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";
import { Effect, Predicate } from "effect";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";

/** The encodings the server sends, in the order it prefers them when the client likes both alike. */
const ENCODINGS = ["br", "gzip"] as const;
type Encoding = (typeof ENCODINGS)[number];

/** Bodies smaller than this go out as they are: the encoding would cost more than it saves. */
const MIN_ENCODED_BYTES = 1024;

/**
 * Text the server sends whole: script, style, markup, JSON, SVG. Media is
 * compressed already, and an event stream is written as it happens, so
 * neither is encoded here.
 */
const COMPRESSIBLE =
  /^(?:text\/(?!event-stream)|application\/(?:json|javascript|manifest\+json)|image\/svg\+xml)/i;

/**
 * Brotli's quality, by whether the client may keep the body. A kept body
 * (it names its version, by `ETag` or an `immutable` lifetime) is encoded
 * once a process at 6 and served from {@link encoded}; 11 would save a
 * further ~10% at ~50x the time. Any other body (`/api/graph` after each
 * change, an action's receipt) is encoded afresh at 4, a few milliseconds
 * for the largest, and never kept.
 */
const BROTLI_QUALITY = { kept: 6, fresh: 4 } as const;

/** The headers a `304` repeats from the `200` it stands for (RFC 9110 §15.4.5). */
const NOT_MODIFIED_HEADERS = [
  "cache-control",
  "content-location",
  "content-security-policy",
  "date",
  "etag",
  "expires",
  "vary",
] as const;

/** Each coding `header` (an `Accept-Encoding`) names, with its weight (RFC 9110 §12.5.3). */
function weights(header: string): Map<string, number> {
  const named = new Map<string, number>();
  for (const part of header.split(",")) {
    const [token = "", ...params] = part.trim().toLowerCase().split(";");
    if (token.trim() === "") continue;
    const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
    const weight = q === undefined ? 1 : Number(q.slice(2));
    named.set(token.trim(), Number.isFinite(weight) ? weight : 0);
  }
  return named;
}

/**
 * The encoding `header` (an `Accept-Encoding`) weighs highest, or none: a
 * coding it does not name takes `*`'s weight, a weight of 0 refuses, and
 * of two codings weighed alike the server's order ({@link ENCODINGS}) wins.
 */
export function acceptedEncoding(header: string | null): Encoding | null {
  if (header === null) return null;
  const named = weights(header);
  const weightOf = (coding: Encoding) => named.get(coding) ?? named.get("*") ?? 0;
  let best: Encoding | null = null;
  for (const coding of ENCODINGS) {
    if (weightOf(coding) > 0 && (best === null || weightOf(coding) > weightOf(best))) best = coding;
  }
  return best;
}

/** An entity tag without its weakness, as a weak comparison reads it. */
function opaque(tag: string): string {
  return tag.trim().replace(/^W\//, "");
}

/** Whether `ifNoneMatch` (an `If-None-Match`) names `etag`, compared weakly as RFC 9110 §13.1.2 says. */
export function matchesEtag(ifNoneMatch: string | null, etag: string | null): boolean {
  if (ifNoneMatch === null || etag === null) return false;
  const ours = opaque(etag);
  return ifNoneMatch.split(",").some((tag) => tag.trim() === "*" || opaque(tag) === ours);
}

function encode(bytes: Uint8Array, encoding: Encoding, quality: number): Uint8Array<ArrayBuffer> {
  return encoding === "br"
    ? brotliCompressSync(bytes, {
        params: {
          [constants.BROTLI_PARAM_QUALITY]: quality,
          [constants.BROTLI_PARAM_SIZE_HINT]: bytes.length,
        },
      })
    : gzipSync(bytes);
}

/** Kept bodies' encodings by their bytes' SHA-256, oldest first, so a page's chunks are encoded once a process. */
const encoded = new Map<string, Uint8Array<ArrayBuffer>>();
let encodedBytes = 0;
const ENCODED_BUDGET_BYTES = 64 * 1024 * 1024;

/** `bytes`, a body the client may keep, in `encoding`: from {@link encoded} when it was encoded before. */
function encodedKept(bytes: Uint8Array, encoding: Encoding): Uint8Array<ArrayBuffer> {
  const key = `${encoding}:${createHash("sha256").update(bytes).digest("base64url")}`;
  const kept = encoded.get(key);
  if (kept !== undefined) {
    // Most recently used goes last, so the budget evicts the coldest.
    encoded.delete(key);
    encoded.set(key, kept);
    return kept;
  }
  const out = encode(bytes, encoding, BROTLI_QUALITY.kept);
  encoded.set(key, out);
  encodedBytes += out.length;
  for (const [oldest, body] of encoded) {
    if (encodedBytes <= ENCODED_BUDGET_BYTES) break;
    encoded.delete(oldest);
    encodedBytes -= body.length;
  }
  return out;
}

/** Whether the client may keep `headers`' body: it names its version, or is kept for good. */
function keptByClient(headers: Headers): boolean {
  return headers.has("etag") || /\bimmutable\b/i.test(headers.get("cache-control") ?? "");
}

function withVary(headers: Headers, name: string): void {
  const vary = headers.get("vary");
  if (vary === null) headers.set("vary", name);
  else if (
    !vary
      .toLowerCase()
      .split(/\s*,\s*/)
      .includes(name.toLowerCase())
  ) {
    headers.set("vary", `${vary}, ${name}`);
  }
}

/**
 * `response`, the answer to `req`, as it is sent: `304` when `req` is a
 * read that revalidates the `ETag` it carries, else its text body in the
 * encoding `req` accepts, whatever its method (a `POST /api/action`
 * receipt, such as the manifest, is the largest JSON the page reads). A
 * streamed body goes as it is written, never gathered to be encoded. Every
 * answer that could have been encoded says it varies by `Accept-Encoding`,
 * a `304` included, so no cache serves one client's encoding to another.
 */
export const deliver = Effect.fn("kb.ui.deliver")(function* (
  req: Request,
  response: HttpServerResponse.HttpServerResponse,
) {
  const res = HttpServerResponse.toWeb(response);
  if (res.status !== 200) return res;

  const type = res.headers.get("content-type");
  const encodable =
    !Predicate.isTagged(response.body, "Stream") &&
    type !== null &&
    COMPRESSIBLE.test(type) &&
    !res.headers.has("content-encoding");
  const headers = new Headers(res.headers);
  if (encodable) withVary(headers, "Accept-Encoding");

  const read = req.method === "GET" || req.method === "HEAD";
  if (read && matchesEtag(req.headers.get("if-none-match"), headers.get("etag"))) {
    const kept = new Headers();
    for (const name of NOT_MODIFIED_HEADERS) {
      const value = headers.get(name);
      if (value !== null) kept.set(name, value);
    }
    return new Response(null, { status: 304, headers: kept });
  }

  if (!encodable || res.body === null) return res;
  const encoding = acceptedEncoding(req.headers.get("accept-encoding"));
  const bytes = new Uint8Array(yield* Effect.promise(() => res.arrayBuffer()));
  if (encoding === null || bytes.length < MIN_ENCODED_BYTES) {
    return new Response(bytes, { status: res.status, headers });
  }
  headers.set("content-encoding", encoding);
  headers.delete("content-length");
  const body = keptByClient(headers)
    ? encodedKept(bytes, encoding)
    : encode(bytes, encoding, BROTLI_QUALITY.fresh);
  return new Response(body, { status: res.status, headers });
});
