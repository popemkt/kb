/**
 * How an HTTP answer travels to the client (DESIGN-UI.md → Delivery): a
 * revalidation of bytes the client already holds is answered `304`, and a
 * text body goes out in the best encoding the client accepts. This is the
 * one place either happens; a route says only what it answers and how long
 * it may be kept (`Cache-Control`, `ETag`), never how it is sent.
 */
import { brotliCompressSync, constants, gzipSync } from "node:zlib";
import { Effect } from "effect";

/** The encodings the server sends, best first. */
type Encoding = "br" | "gzip";

/** Bodies smaller than this go out as they are: the encoding would cost more than it saves. */
const MIN_ENCODED_BYTES = 1024;

/** Text the server sends: script, style, markup, JSON, SVG. Media is compressed already. */
const COMPRESSIBLE = /^(?:text\/|application\/(?:json|javascript|manifest\+json)|image\/svg\+xml)/i;

/**
 * Brotli's quality. 11 saves a further ~10% at ~50x the time; at 6 a 1 MB
 * chunk encodes in tens of milliseconds, once ({@link encodedOf} keeps it).
 */
const BROTLI_QUALITY = 6;

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

/** The best encoding `header` (an `Accept-Encoding`) accepts, or none. */
export function acceptedEncoding(header: string | null): Encoding | null {
  if (header === null) return null;
  const accepted = new Set<string>();
  for (const part of header.split(",")) {
    const [token = "", ...params] = part.trim().toLowerCase().split(";");
    const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
    if (q !== undefined && Number(q.slice(2)) <= 0) continue;
    accepted.add(token.trim());
  }
  if (accepted.has("br")) return "br";
  if (accepted.has("gzip")) return "gzip";
  return null;
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

function encode(bytes: Uint8Array, encoding: Encoding): Uint8Array<ArrayBuffer> {
  return encoding === "br"
    ? brotliCompressSync(bytes, {
        params: {
          [constants.BROTLI_PARAM_QUALITY]: BROTLI_QUALITY,
          [constants.BROTLI_PARAM_SIZE_HINT]: bytes.length,
        },
      })
    : gzipSync(bytes);
}

/** Encoded bodies by their bytes' digest, oldest first, so a page's chunks are encoded once a process. */
const encoded = new Map<string, Uint8Array<ArrayBuffer>>();
let encodedBytes = 0;
const ENCODED_BUDGET_BYTES = 64 * 1024 * 1024;

/** `bytes` in `encoding`, from {@link encoded} when it was encoded before. */
function encodedOf(bytes: Uint8Array, encoding: Encoding): Uint8Array<ArrayBuffer> {
  const key = `${encoding}:${bytes.length}:${Bun.hash(bytes).toString(36)}`;
  const kept = encoded.get(key);
  if (kept !== undefined) {
    // Most recently used goes last, so the budget evicts the coldest.
    encoded.delete(key);
    encoded.set(key, kept);
    return kept;
  }
  const out = encode(bytes, encoding);
  encoded.set(key, out);
  encodedBytes += out.length;
  for (const [oldest, body] of encoded) {
    if (encodedBytes <= ENCODED_BUDGET_BYTES) break;
    encoded.delete(oldest);
    encodedBytes -= body.length;
  }
  return out;
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
 * `res`, the answer to `req`, as it is sent: `304` when `req` is a read
 * that revalidates the `ETag` it carries, else its text body in the
 * encoding `req` accepts, whatever its method (a `POST /api/action`
 * receipt, such as the manifest, is the largest JSON the page reads).
 */
export const deliver = Effect.fn("kb.ui.deliver")(function* (req: Request, res: Response) {
  if (res.status !== 200) return res;

  const read = req.method === "GET" || req.method === "HEAD";
  if (read && matchesEtag(req.headers.get("if-none-match"), res.headers.get("etag"))) {
    const headers = new Headers();
    for (const name of NOT_MODIFIED_HEADERS) {
      const value = res.headers.get(name);
      if (value !== null) headers.set(name, value);
    }
    return new Response(null, { status: 304, headers });
  }

  const type = res.headers.get("content-type");
  if (res.body === null || res.headers.has("content-encoding") || type === null) return res;
  if (!COMPRESSIBLE.test(type)) return res;

  const headers = new Headers(res.headers);
  withVary(headers, "Accept-Encoding");
  const encoding = acceptedEncoding(req.headers.get("accept-encoding"));
  const bytes = new Uint8Array(yield* Effect.promise(() => res.arrayBuffer()));
  if (encoding === null || bytes.length < MIN_ENCODED_BYTES) {
    return new Response(bytes, { status: res.status, headers });
  }
  headers.set("content-encoding", encoding);
  headers.delete("content-length");
  return new Response(encodedOf(bytes, encoding), { status: res.status, headers });
});
