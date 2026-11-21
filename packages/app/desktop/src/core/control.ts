/**
 * The control server: the desktop's own pages and the calls they make, on a
 * loopback port of this process. It is how the app's chrome reaches the core
 * without any shell's bridge, so an Electrobun window, a Tauri window or a
 * browser tab all drive it the same way. Every call carries the session's
 * token in a header: another page cannot read it, and cannot send the
 * header cross-origin without a preflight this server never answers.
 */
import { Cause, Effect, Option, Schema } from "effect";
import { capturePage, storesPage } from "./pages.ts";

/** A refusal the page shows the person as it is. */
interface Refusal {
  readonly message: string;
}

/** What the pages ask the app to do. */
export interface ControlActions {
  readonly listStores: Effect.Effect<unknown, Refusal>;
  readonly openStore: (key: string) => Effect.Effect<void, Refusal>;
  readonly addLocal: (path: string, name: string) => Effect.Effect<void, Refusal>;
  /** Pair with the host at `origin` with its one-use `code`, and add its store. */
  readonly addRemote: (name: string, origin: string, code: string) => Effect.Effect<void, Refusal>;
  readonly removeStore: (key: string) => Effect.Effect<void, Refusal>;
  readonly setCaptureStore: (key: string) => Effect.Effect<void>;
  readonly captureTarget: Effect.Effect<{ name: string }, Refusal>;
  readonly capture: (text: string) => Effect.Effect<{ nodeId: string }, Refusal>;
  readonly closeCapture: Effect.Effect<void>;
}

export interface ControlServer {
  readonly origin: string;
  /** The URL of one of the desktop's pages. */
  pageUrl(page: "capture" | "stores"): string;
  stop(): void;
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

/** What a page posts: each call reads the members it names, and a missing one is empty. */
const ControlBodySchema = Schema.Struct({
  key: Schema.optionalKey(Schema.String),
  path: Schema.optionalKey(Schema.String),
  name: Schema.optionalKey(Schema.String),
  origin: Schema.optionalKey(Schema.String),
  code: Schema.optionalKey(Schema.String),
  text: Schema.optionalKey(Schema.String),
});
type ControlBody = typeof ControlBodySchema.Type;
const decodeBody = Schema.decodeUnknownOption(ControlBodySchema);

function bodyOf(raw: unknown): ControlBody {
  return Option.getOrElse(decodeBody(raw), () => ({}));
}

/** A posted member as a person meant it: trimmed, and empty when missing. */
function trimmed(value: string | undefined): string {
  return (value ?? "").trim();
}

export function startControlServer(
  actions: ControlActions,
  token: string = crypto.randomUUID(),
): ControlServer {
  const routes: Record<string, (body: ControlBody) => Effect.Effect<unknown, Refusal>> = {
    "/api/stores": () => actions.listStores,
    "/api/stores/open": (b) => actions.openStore(trimmed(b.key)),
    "/api/stores/add-local": (b) => actions.addLocal(trimmed(b.path), trimmed(b.name)),
    "/api/stores/add-remote": (b) =>
      actions.addRemote(trimmed(b.name), trimmed(b.origin), trimmed(b.code)),
    "/api/stores/remove": (b) => actions.removeStore(trimmed(b.key)),
    "/api/settings/capture-store": (b) => actions.setCaptureStore(trimmed(b.key)),
    "/api/capture/target": () => actions.captureTarget,
    // The text as typed: no trim, so line breaks and spacing reach the host.
    "/api/capture": (b) => actions.capture(b.text ?? ""),
    "/api/capture/close": () => actions.closeCapture,
  };
  /** One API call: the route's answer, its refusal as 422, a defect as 500. */
  const answer = Effect.fn("kb.desktop.control.answer")(
    function* (req: Request, route: (body: ControlBody) => Effect.Effect<unknown, Refusal>) {
      const raw: unknown =
        req.method === "POST" ? yield* Effect.promise(() => req.json().catch(() => null)) : null;
      const result = yield* route(bodyOf(raw));
      return json(result ?? { ok: true });
    },
    (effect) =>
      effect.pipe(
        Effect.catch((refusal: Refusal) => Effect.succeed(json({ error: refusal.message }, 422))),
        Effect.catchCause((cause) =>
          Effect.succeed(json({ error: String(Cause.squash(cause)) }, 500)),
        ),
      ),
  );
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(req) {
      const url = new URL(req.url);
      if (req.method === "GET" && (url.pathname === "/capture" || url.pathname === "/stores")) {
        if (url.searchParams.get("t") !== token) return new Response("forbidden", { status: 403 });
        const page = url.pathname === "/capture" ? capturePage(token) : storesPage(token);
        return new Response(page, {
          headers: {
            "content-type": "text/html;charset=utf-8",
            "cache-control": "no-store",
            "content-security-policy":
              "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'",
          },
        });
      }
      const route = routes[url.pathname];
      if (route === undefined) return json({ error: "not found" }, 404);
      if (req.headers.get("x-kb-desktop") !== token) return json({ error: "forbidden" }, 403);
      return Effect.runPromise(answer(req, route));
    },
  });
  const origin = `http://127.0.0.1:${server.port}`;
  return {
    origin,
    pageUrl: (page) => `${origin}/${page}?t=${encodeURIComponent(token)}`,
    stop: () => void server.stop(true),
  };
}
