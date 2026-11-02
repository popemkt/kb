import { expect, test } from "bun:test";
import { Effect, Result, type Scope } from "effect";
import { TestClock } from "effect/testing";
import type { SyncError } from "@kb/routines";
import { SecretError } from "@kb/contracts";
import {
  beginGoogleConnect,
  makeGoogleTokens,
  CALENDAR_SCOPE,
  type OAuthOptions,
} from "../src/index.ts";

function fixture() {
  let trusted = true;
  const calls: URLSearchParams[] = [];
  const writes: string[] = [];
  const reads: string[] = [];
  let revoked = false;
  const options: OAuthOptions = {
    account: {
      id: "account",
      email: "owner@test",
      clientId: "env:CLIENT",
      clientSecret: "env:SECRET",
      refreshToken: "dotenv:/private/google.env#TOKEN",
    },
    trusted: Effect.sync(() => trusted),
    secrets: {
      resolve: (reference) =>
        Effect.gen(function* () {
          reads.push(reference.kind);
          if (reference.kind === "env")
            return reference.name === "CLIENT" ? "desktop-client" : "desktop-secret";
          if (reference.kind === "dotenv") return "saved-refresh";
          return yield* new SecretError({ message: "unsupported fixture reference" });
        }),
    },
    sink: (reference) => ({
      write: (value) =>
        Effect.sync(() => {
          expect(reference).toBe(options.account.refreshToken);
          writes.push(value);
        }),
    }),
    fetch: Object.assign(
      (input: string | URL | Request, init?: RequestInit) => {
        expect(input instanceof Request ? input.url : input.toString()).toBe(
          "https://oauth2.googleapis.com/token",
        );
        expect(init?.redirect).toBe("error");
        if (!(init?.body instanceof URLSearchParams)) throw new Error("expected form body");
        calls.push(new URLSearchParams(init.body));
        return Promise.resolve(
          new Response(
            JSON.stringify(
              revoked
                ? { error: "invalid_grant", error_description: "NEVER_LOG_THIS" }
                : {
                    access_token: "access-secret",
                    refresh_token: "rotated-secret",
                    expires_in: 3600,
                  },
            ),
            { status: revoked ? 400 : 200 },
          ),
        );
      },
      { preconnect: fetch.preconnect },
    ),
  };
  return {
    options,
    calls,
    writes,
    reads,
    trust: (value: boolean) => {
      trusted = value;
    },
    revoke: () => {
      revoked = true;
    },
  };
}
function effectTest(name: string, run: Effect.Effect<void, SyncError, Scope.Scope>) {
  test(name, () => Effect.runPromise(Effect.scoped(run).pipe(Effect.provide(TestClock.layer()))));
}
effectTest(
  "tokens require trust before resolving secrets; refresh rotates only the bound sink",
  Effect.gen(function* () {
    const f = fixture();
    const tokens = yield* makeGoogleTokens(f.options);
    f.trust(false);
    expect(Result.isFailure(yield* Effect.result(tokens.access))).toBe(true);
    expect(f.reads).toHaveLength(0);
    expect(f.calls).toHaveLength(0);
    f.trust(true);
    const accesses = yield* Effect.all([tokens.access, tokens.access], { concurrency: 2 });
    expect(accesses).toEqual(["access-secret", "access-secret"]);
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]?.get("refresh_token")).toBe("saved-refresh");
    expect(f.writes).toEqual(["rotated-secret"]);
    yield* TestClock.adjust("1 hour");
    yield* tokens.access;
    expect(f.calls).toHaveLength(2);
    f.revoke();
    const failed = yield* Effect.result(tokens.refresh);
    expect(Result.isFailure(failed) ? failed.failure.code : "success").toBe("auth_needed");
    expect(JSON.stringify(failed)).not.toContain("NEVER_LOG_THIS");
  }),
);
effectTest(
  "PKCE validates state and binding trust; pasted redirects are one-shot",
  Effect.gen(function* () {
    const f = fixture();
    const step = yield* beginGoogleConnect(f.options);
    const url = new URL(step.url);
    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.searchParams.get("scope")).toBe(CALENDAR_SCOPE);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    const callback = new URL(url.searchParams.get("redirect_uri") ?? "");
    expect(callback.hostname).toBe("127.0.0.1");
    callback.searchParams.set("code", "one-shot-code");
    callback.searchParams.set("state", "wrong-state");
    expect(Result.isFailure(yield* Effect.result(step.finish(callback.toString())))).toBe(true);
    expect(f.calls).toHaveLength(0);
    callback.searchParams.set("state", url.searchParams.get("state") ?? "");
    f.trust(false);
    expect(Result.isFailure(yield* Effect.result(step.finish(callback.toString())))).toBe(true);
    f.trust(true);
    yield* step.finish(callback.toString());
    const verifier = f.calls[0]?.get("code_verifier") ?? "";
    const digest = yield* Effect.promise(() =>
      crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
    );
    const encoded = btoa(String.fromCharCode(...new Uint8Array(digest)))
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replace(/=+$/, "");
    expect(encoded).toBe(url.searchParams.get("code_challenge") ?? "");
    expect(f.writes).toEqual(["rotated-secret"]);
    expect(Result.isFailure(yield* Effect.result(step.finish(callback.toString())))).toBe(true);
    expect(f.calls).toHaveLength(1);
  }),
);
effectTest(
  "desktop loopback receives the callback without putting tokens in the response",
  Effect.gen(function* () {
    const f = fixture();
    const step = yield* beginGoogleConnect(f.options);
    const url = new URL(step.url);
    const callback = new URL(url.searchParams.get("redirect_uri") ?? "");
    callback.searchParams.set("code", "test-code");
    callback.searchParams.set("state", url.searchParams.get("state") ?? "");
    const response = yield* Effect.promise(() => fetch(callback));
    expect(response.status).toBe(200);
    const text = yield* Effect.promise(() => response.text());
    expect(text).not.toContain("test-code");
    expect(text).not.toContain("rotated-secret");
    yield* step.finish();
    expect(f.writes).toHaveLength(1);
  }),
);
