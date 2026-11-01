import { relative } from "node:path";
import { Cause, Effect, Option } from "effect";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import {
  listingOf,
  onWire,
  requestOf,
  type ActionResponse,
  type Embedding,
  type HostedFamilies,
  type KbContext,
  type ServerIdentity,
  type SurfaceWire,
} from "@kb/contracts";
import { servedPage, type ActionHandlerEnv } from "@kb/runtime";
import { SANDBOX_FRAME_HEADERS, SANDBOX_FRAME_PATH, sandboxFrameDocument } from "@kb/sandbox";
import { canonicalRoot } from "@kb/workspace-fs";
import * as assets from "./assets.ts";
import { deliver } from "./delivery.ts";
import { HTTP_WIRE } from "./guard.ts";
import { serverInvoke } from "./invoke.ts";
import { listSavedQueriesEffect } from "./saved-queries.ts";
import { serverRuntimeLayer } from "./screens.ts";
import type { SubscriptionHub } from "./session.ts";

/** Match Bun/Web `Response.json` Content-Type exactly. */
const JSON_CONTENT_TYPE = "application/json;charset=utf-8";

export interface UiHttpDeps {
  root: string;
  /** Where its page is (`uiAddressOf` its listener), as `/api/identity` says it. */
  page: string;
  ctx: KbContext;
  hub: SubscriptionHub;
  /** The extensions the server hosts beside the registry's, as it reports them; none when absent. */
  hosted?: HostedFamilies;
  /** What an app that frames the page may have (`UiServerOptions.embedding`); nothing when absent. */
  embedding?: Embedding;
}

function jsonResponse(
  body: unknown,
  options?: { status?: number },
): HttpServerResponse.HttpServerResponse {
  return HttpServerResponse.jsonUnsafe(body, {
    status: options?.status,
    contentType: JSON_CONTENT_TYPE,
  });
}

/** Match pre-Effect `new Response(body, { status })` — no Content-Type. */
function plainStatus(body: string, status: number): HttpServerResponse.HttpServerResponse {
  return HttpServerResponse.raw(body, { status });
}

function internalFailure(err: unknown): HttpServerResponse.HttpServerResponse {
  const message = err instanceof Error ? err.message : String(err);
  return jsonResponse({ status: "failed", code: "internal", message }, { status: 500 });
}

function invalidInput(message: string): HttpServerResponse.HttpServerResponse {
  return jsonResponse(
    { status: "failed", id: "unknown", code: "invalid_input", message },
    { status: 400 },
  );
}

/**
 * JSON its owner keeps as text, at a version: sent as it is, naming the
 * version as its entity tag, and revalidated on every use (`no-cache`), so a
 * client that holds this version is answered `304` and one that does not
 * gets the text without it being serialised again (`deliver` keeps its
 * encoding).
 */
class KeptJson {
  readonly json: string;
  readonly version: string;

  constructor(json: string, version: string) {
    this.json = json;
    this.version = version;
  }
}

/** A read of the API: a `GET` that answers JSON, as a value or as text its owner keeps. */
type JsonRead = (deps: UiHttpDeps) => Effect.Effect<unknown, never, ActionHandlerEnv>;

function readResponse(body: unknown): HttpServerResponse.HttpServerResponse {
  if (!(body instanceof KeptJson)) return jsonResponse(body);
  return HttpServerResponse.text(body.json, {
    contentType: JSON_CONTENT_TYPE,
    headers: { etag: `"${body.version}"`, "cache-control": "no-cache" },
  });
}

/** The API's reads, by path. */
const JSON_READS: ReadonlyMap<string, JsonRead> = new Map<string, JsonRead>([
  [
    "/api/graph",
    ({ hub }) =>
      Effect.sync(() => {
        const { json, version } = hub.graph;
        return new KeptJson(json, version);
      }),
  ],
  [
    "/api/manifest",
    ({ ctx }) =>
      serverInvoke(ctx, onWire(HTTP_WIRE, { id: "kb.manifest", input: {} })).pipe(
        Effect.map((receipt) => listingOf(HTTP_WIRE, receipt)),
        // A store that cannot be reloaded lists nothing, as a refused manifest does.
        Effect.orElseSucceed(() => []),
      ),
  ],
  ["/api/queries", ({ root }) => listSavedQueriesEffect(root)],
  [
    "/api/identity",
    ({ root, page }) =>
      canonicalRoot(root).pipe(Effect.map((served): ServerIdentity => ({ root: served, page }))),
  ],
]);

/** A read of a file the server serves by path, before the SPA: the paths it owns, and how it answers one. */
interface FileRead {
  readonly owns: (path: string) => boolean;
  readonly read: (
    deps: UiHttpDeps,
    path: string,
  ) => Effect.Effect<HttpServerResponse.HttpServerResponse, never, ActionHandlerEnv>;
}

/**
 * How a page half is served: to this origin's page alone, as script and
 * nothing else, and kept, since its path is its digest and so names these
 * bytes for good.
 */
const EXTENSION_PAGE_HEADERS = {
  "cross-origin-resource-policy": "same-origin",
  "x-content-type-options": "nosniff",
  "cache-control": "private, max-age=31536000, immutable",
};

/** The files the server serves by path, in order; a path none owns falls through to the SPA. */
const FILE_READS: readonly FileRead[] = [
  // The sandbox frame's document, served with the policy that fences it
  // (DESIGN.md → Sandbox → The frame); its script is a ui/dist file.
  {
    owns: (path) => path === SANDBOX_FRAME_PATH,
    read: () =>
      Effect.succeed(
        HttpServerResponse.raw(sandboxFrameDocument(), {
          status: 200,
          headers: SANDBOX_FRAME_HEADERS,
        }),
      ),
  },
  // W6a: opaque media files — before SPA / ui/dist so /assets never
  // falls through to index.html.
  {
    owns: (path) => path === "/assets" || path.startsWith("/assets/"),
    read: ({ root }, path) => assets.serveKbAssetEffect(root, path),
  },
  // A repository extension's page half, by its closure's digest: what the
  // page imports for a row that names it (`extensionPagePath`), while its
  // family is trusted and on.
  {
    owns: (path) => path.startsWith("/api/extensions/"),
    read: ({ root, ctx }, path) =>
      servedPage(root, path, (id) => ctx.index.getNode(id)).pipe(
        Effect.map((code) =>
          code === null
            ? plainStatus("not found", 404)
            : HttpServerResponse.text(code, {
                contentType: "text/javascript;charset=utf-8",
                headers: EXTENSION_PAGE_HEADERS,
              }),
        ),
      ),
  },
];

/**
 * HTTP/API routing for `kb ui` (WebSocket upgrade stays on the Bun.serve
 * boundary in `server.ts`).
 *
 * Genuine Effect program: route dispatch, asset reads, saved-query reads,
 * store reloads and snapshot reads are all Effect programs. Content-Type
 * matches the pre-Effect surface (`Response.json` charset + bare text bodies).
 */
const handleHttpRequestEffect = (
  req: Request,
  wire: SurfaceWire,
  deps: UiHttpDeps,
): Effect.Effect<HttpServerResponse.HttpServerResponse, never, ActionHandlerEnv> =>
  Effect.gen(function* () {
    const { ctx } = deps;
    const url = new URL(req.url);

    const read = req.method === "GET" ? JSON_READS.get(url.pathname) : undefined;
    if (read !== undefined) {
      return readResponse(yield* read(deps));
    }

    // The request guard (`guard.ts`) has already refused another site's
    // page, and said whose wire this is: the page's when it carries the UI's
    // Origin, else a local program's.
    if (url.pathname === "/api/action" && req.method === "POST") {
      const body = yield* Effect.tryPromise(() => req.json()).pipe(Effect.option);
      if (Option.isNone(body)) {
        return invalidInput("request body must be JSON");
      }

      const made = requestOf(body.value);
      if ("invalid" in made) return invalidInput(made.invalid);

      const receipt = yield* serverInvoke(ctx, onWire(wire, made.request));
      // The head once the invocation has committed: the rev a client waits
      // for before it lets the server's image replace its own (protocol.ts →
      // ActionResponseSchema).
      const response: ActionResponse =
        receipt.status === "succeeded" ? { ...receipt, rev: ctx.log.head } : receipt;
      return jsonResponse(response);
    }

    const file =
      req.method === "GET" ? FILE_READS.find(({ owns }) => owns(url.pathname)) : undefined;
    if (file !== undefined) return yield* file.read(deps, url.pathname);

    if (url.pathname.startsWith("/api/") || url.pathname === "/ws") {
      return plainStatus("not found", 404);
    }

    const staticResp = yield* assets.serveStaticEffect(url.pathname, deps.embedding?.origins ?? []);
    if (staticResp) return staticResp;

    return jsonResponse(
      {
        error: "ui_not_built",
        message:
          "kb UI assets not found; build packages/app/ui (its dist/) or use the API/WS endpoints",
        hint: relative(process.cwd(), assets.UI_DIST),
      },
      { status: 503 },
    );
  }).pipe(
    Effect.catchCause((cause) =>
      Cause.hasInterruptsOnly(cause)
        ? Effect.interrupt
        : Effect.succeed(internalFailure(Cause.squash(cause))),
    ),
  );

/**
 * Promise facade for the HTTP layer: runs the routing Effect, for a request
 * the guard let through on `wire`, against the
 * server's runtime Layer (FileSystem + store + session + templates + the
 * screens this server holds), converts the response to a Web `Response`,
 * and sends it as every answer is sent (`delivery.ts`).
 */
export function handleHttpRequest(
  req: Request,
  wire: SurfaceWire,
  deps: UiHttpDeps,
): Promise<Response> {
  return Effect.runPromise(
    handleHttpRequestEffect(req, wire, deps).pipe(
      Effect.provide(serverRuntimeLayer(deps.ctx, deps.hub.screens, deps.hosted)),
      Effect.flatMap((response) => deliver(req, response)),
    ),
  );
}
