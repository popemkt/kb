/**
 * How the gallery reaches a source on the network, stated once for every
 * adapter. It is the posture `agent-openai`'s chat states for a provider:
 * https only, bounded time, bounded bodies, and a failure that names the
 * origin and status, never the body. One thing differs, because image hosts
 * need it: a redirect is followed, at most {@link MAX_REDIRECTS} times, and
 * only to an https host the adapter names (Civitai serves its images from a
 * blob host it redirects to).
 */
import { Effect } from "effect";
import { domainError, type DomainError } from "@kb/model";

/** What a request hands `fetch`: one GET, redirects returned rather than followed, cancelled through `signal`. */
export interface SourceRequestInit {
  readonly signal: AbortSignal;
  readonly redirect: "manual";
  readonly headers: Readonly<Record<string, string>>;
}

/** The part of `fetch` the gallery uses; a test hands it a fake source. */
export type SourceFetch = (url: string, init: SourceRequestInit) => Promise<Response>;

/** Who is asking, as sources ask a client to say (Openverse, Wikimedia). */
const USER_AGENT = "kb-gallery/0.1 (+https://github.com/popemkt/kb)";
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_REDIRECTS = 2;
/** A search answer larger than this is not a search answer. */
const JSON_MAX_BYTES = 4 * 1024 * 1024;

/** Whether a source's request may go to `url`: https, no credentials of its own, a host `allowed` names. */
function sendable(url: URL, allowed: (host: string) => boolean): boolean {
  return (
    url.protocol === "https:" &&
    url.username === "" &&
    url.password === "" &&
    allowed(url.hostname.toLowerCase())
  );
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * GET `url` from a host `allowed` names, following at most two redirects to
 * hosts it also names. The response is open until the scope closes.
 */
export const getFrom = Effect.fn("gallery.get")(function* (
  send: SourceFetch,
  target: string,
  allowed: (host: string) => boolean,
  accept: string,
) {
  let url = yield* Effect.try({
    try: () => new URL(target),
    catch: () => domainError("invalid_input", `Not a URL: ${target}`),
  });
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!sendable(url, allowed))
      return yield* domainError("forbidden", `The gallery does not send to ${url.origin}`);
    const origin = url.origin;
    const controller = yield* Effect.acquireRelease(
      Effect.sync(() => new AbortController()),
      (c) => Effect.sync(() => c.abort()),
    );
    const href = url.href;
    const response = yield* Effect.tryPromise({
      try: () =>
        send(href, {
          signal: controller.signal,
          redirect: "manual",
          headers: { accept, "user-agent": USER_AGENT },
        }),
      catch: (error) => domainError("internal", `${origin} did not answer: ${messageOf(error)}`),
    }).pipe(
      Effect.timeoutOrElse({
        duration: REQUEST_TIMEOUT_MS,
        orElse: () =>
          Effect.fail(
            domainError(
              "internal",
              `${origin} did not answer within ${REQUEST_TIMEOUT_MS / 1000}s`,
            ),
          ),
      }),
    );
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (location === null) return yield* domainError("internal", `${origin} redirected nowhere`);
      const from = url;
      url = yield* Effect.try({
        try: () => new URL(location, from),
        catch: () => domainError("internal", `${origin} redirected to something not a URL`),
      });
      continue;
    }
    if (!response.ok)
      return yield* domainError("internal", `${origin} answered ${response.status}`);
    return response;
  }
  return yield* domainError("internal", `${target} redirected more than ${MAX_REDIRECTS} times`);
});

/** At most `max` bytes of a body; a longer one fails rather than being held. */
export const boundedBytes = Effect.fn("gallery.body")(function* (
  response: Response,
  max: number,
): Effect.fn.Return<Uint8Array, DomainError> {
  const body = response.body;
  if (body === null) return new Uint8Array(0);
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let read = 0;
  yield* Effect.gen(function* () {
    for (;;) {
      const next = yield* Effect.tryPromise({
        try: () => reader.read(),
        catch: (error) => domainError("internal", `The answer broke off: ${messageOf(error)}`),
      });
      if (next.done) return undefined;
      read += next.value.byteLength;
      if (read > max)
        return yield* domainError("invalid_input", `The answer is larger than ${max} bytes`);
      chunks.push(next.value);
    }
  }).pipe(
    Effect.ensuring(Effect.promise(() => reader.cancel().catch(() => undefined))),
    Effect.timeoutOrElse({
      duration: REQUEST_TIMEOUT_MS,
      orElse: () => Effect.fail(domainError("internal", "The answer took too long to arrive")),
    }),
  );
  const bytes = new Uint8Array(read);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.byteLength;
  }
  return bytes;
});

/** GET and parse a JSON answer from a host `allowed` names. */
export const getJson = Effect.fn("gallery.json")(function* (
  send: SourceFetch,
  url: string,
  allowed: (host: string) => boolean,
) {
  const response = yield* getFrom(send, url, allowed, "application/json");
  const bytes = yield* boundedBytes(response, JSON_MAX_BYTES);
  return yield* Effect.try({
    try: (): unknown => JSON.parse(new TextDecoder().decode(bytes)),
    catch: () => domainError("internal", `${url} answered something not JSON`),
  });
}, Effect.scoped);
