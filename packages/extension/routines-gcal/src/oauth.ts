import { Clock, Effect, Schema, Semaphore } from "effect";
import type { SecretSink, SecretSource } from "@kb/contracts";
import { parseSecretRef } from "@kb/model";
import { SyncError, type AccountConfig } from "@kb/routines";
import { readJson, boundedNetwork, type GoogleTokens } from "./http.ts";

export const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.app.created";
const Token = Schema.Struct({
  access_token: Schema.String,
  expires_in: Schema.Int,
  refresh_token: Schema.optionalKey(Schema.String),
});
const auth = () => new SyncError({ status: 401, code: "auth_needed" });
export interface OAuthOptions {
  readonly account: AccountConfig;
  readonly secrets: SecretSource;
  readonly sink: (reference: string) => SecretSink;
  readonly trusted: Effect.Effect<boolean, SyncError>;
  readonly fetch?: typeof fetch;
}
const secret = Effect.fn("routines.oauth.secret")(function* (
  source: SecretSource,
  reference: string,
) {
  const parsed = parseSecretRef(reference);
  if (parsed === null) return yield* auth();
  return yield* source.resolve(parsed).pipe(Effect.mapError(auth));
});
const tokenRequest = Effect.fn("routines.oauth.tokenRequest")(function* (
  fetcher: typeof fetch,
  body: URLSearchParams,
) {
  const response = yield* boundedNetwork(
    Effect.tryPromise({
      try: (signal) =>
        fetcher("https://oauth2.googleapis.com/token", {
          method: "POST",
          redirect: "error",
          body,
          signal,
        }),
      catch: () => new SyncError({ status: 0, code: "offline" }),
    }),
  );
  if (!response.ok)
    return yield* response.status >= 500
      ? new SyncError({ status: response.status, code: "upstream" })
      : auth();
  const raw = yield* readJson(response);
  return yield* Schema.decodeUnknownEffect(Token)(raw).pipe(Effect.mapError(auth));
});

/** Secrets are resolved only inside a trusted request and are never returned. */
export const makeGoogleTokens = Effect.fn("routines.oauth.tokens")(function* (
  options: OAuthOptions,
) {
  let cached: { token: string; until: number } | null = null;
  const lock = yield* Semaphore.make(1);
  const refresh = Effect.gen(function* () {
    if (!(yield* options.trusted)) return yield* new SyncError({ status: 403, code: "untrusted" });
    const client = yield* secret(options.secrets, options.account.clientId);
    const clientSecret = yield* secret(options.secrets, options.account.clientSecret);
    const refreshToken = yield* secret(options.secrets, options.account.refreshToken);
    const token = yield* tokenRequest(
      options.fetch ?? fetch,
      new URLSearchParams({
        client_id: client,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    );
    if (token.refresh_token !== undefined)
      yield* options
        .sink(options.account.refreshToken)
        .write(token.refresh_token)
        .pipe(Effect.mapError(auth));
    cached = {
      token: token.access_token,
      until: (yield* Clock.currentTimeMillis) + Math.max(0, token.expires_in - 60) * 1000,
    };
    return undefined;
  });
  const access = lock.withPermit(
    Effect.gen(function* () {
      if (!(yield* options.trusted))
        return yield* new SyncError({ status: 403, code: "untrusted" });
      if (cached === null || cached.until <= (yield* Clock.currentTimeMillis)) yield* refresh;
      if (cached === null) return yield* auth();
      return cached.token;
    }),
  );
  return { access, refresh: lock.withPermit(refresh) } satisfies GoogleTokens;
});

/** One-shot PKCE challenge. Paste the entire redirect URL when using a remote server. */
export const beginGoogleConnect = Effect.fn("routines.oauth.begin")(function* (
  options: OAuthOptions,
) {
  if (!(yield* options.trusted)) return yield* new SyncError({ status: 403, code: "untrusted" });
  const destination = parseSecretRef(options.account.refreshToken);
  if (destination === null || destination.kind !== "dotenv") return yield* auth();
  const client = yield* secret(options.secrets, options.account.clientId);
  const state = crypto.randomUUID();
  const verifier =
    crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "");
  const digest = yield* Effect.promise(() =>
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
  );
  const challenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
  let redirect: string | null = null;
  const server = yield* Effect.acquireRelease(
    Effect.sync(() =>
      Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        fetch: (request) => {
          const url = new URL(request.url);
          if (
            url.pathname !== "/callback" ||
            url.searchParams.get("state") !== state ||
            url.searchParams.get("code") === null
          )
            return new Response("Invalid authorization callback", { status: 400 });
          if (redirect !== null)
            return new Response("Authorization already received", { status: 409 });
          redirect = url.toString();
          return new Response("Authorization received. Return to kb and finish connecting.", {
            headers: { "Cache-Control": "no-store" },
          });
        },
      }),
    ),
    (listener) => Effect.promise(() => listener.stop(true)),
  );
  yield* Effect.forkScoped(
    Effect.sleep("10 minutes").pipe(Effect.andThen(Effect.promise(() => server.stop(true)))),
  );
  const redirectUri = "http://127.0.0.1:" + server.port + "/callback";
  const started = yield* Clock.currentTimeMillis;
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  for (const [key, value] of Object.entries({
    client_id: client,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: CALENDAR_SCOPE,
    access_type: "offline",
    prompt: "consent",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  }))
    url.searchParams.set(key, value);
  let consumed = false;
  const finish = Effect.fn("routines.oauth.finish")(function* (pasted?: string) {
    if (consumed || (yield* Clock.currentTimeMillis) > started + 600_000) return yield* auth();
    if (!(yield* options.trusted)) return yield* new SyncError({ status: 403, code: "untrusted" });
    const callback = yield* Effect.try({
      try: () => new URL(pasted ?? redirect ?? ""),
      catch: auth,
    });
    if (
      callback.origin + callback.pathname !== redirectUri ||
      callback.searchParams.get("state") !== state
    )
      return yield* auth();
    const code = callback.searchParams.get("code");
    if (code === null || code === "") return yield* auth();
    consumed = true;
    const clientSecret = yield* secret(options.secrets, options.account.clientSecret);
    const token = yield* tokenRequest(
      options.fetch ?? fetch,
      new URLSearchParams({
        client_id: client,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
        code_verifier: verifier,
        grant_type: "authorization_code",
      }),
    );
    if (token.refresh_token === undefined) return yield* auth();
    yield* options
      .sink(options.account.refreshToken)
      .write(token.refresh_token)
      .pipe(Effect.mapError(auth));
    yield* Effect.promise(() => server.stop(true));
    return undefined;
  });
  return { url: url.toString(), finish };
});
