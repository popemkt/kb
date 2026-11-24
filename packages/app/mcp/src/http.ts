/**
 * `kb mcp --listen` (DESIGN.md → Surfaces → MCP): the MCP server stdio
 * serves, over Streamable HTTP at {@link MCP_PATH}. Only the transport
 * differs: the tools, the resources and every call's wire are the session's
 * (`mcp.ts`), and a write is labelled with the `KB_VIA` the process was
 * started with, as on stdio.
 *
 * It is stateless: each POST carries one JSON-RPC message and gets a fresh
 * SDK server and transport over the one open root, answered as JSON. There
 * is no session to resume and no stream from the server, so GET and DELETE
 * on the path are refused, and every other path is not found. A request is
 * bounded before it reaches the store: its body's size, its one message,
 * how many run at once, and a deadline that covers a write's wait for the
 * store's lock.
 *
 * It checks no token and knows no caller. It listens only where this
 * machine alone can reach it, a loopback port or a socket its owner alone
 * can connect to, and whatever puts it in front of anyone else (a proxy that
 * authenticates) is the deployment's, not kb's.
 */
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { Effect, Exit, Scope } from "effect";
import type { FileSystem } from "effect/FileSystem";
import type { ServerListener } from "@kb/contracts";
import {
  type BindOptions,
  hostsOf,
  listen,
  listenerOfAddress,
  onThisMachineOnly,
  requestHealth,
} from "@kb/listener";
import { type DomainError, domainError } from "@kb/model";
import { ASSET_BYTES_INPUT_MAX } from "@kb/operations";
import { bunFileSystemLayer, writeErr } from "@kb/runtime";
import { type McpOptions, type McpSession, mcpServerOf, openMcpSession } from "./mcp.ts";

/** The one path the server answers on. */
export const MCP_PATH = "/mcp";

/** A running `kb mcp --listen`. */
interface McpListening {
  /** Where it listens: a TCP port of 0 is the one it bound. */
  readonly at: ServerListener;
  /** Stop listening, let calls in flight settle, then close the root. */
  readonly stop: Effect.Effect<void>;
}

/** The most requests whose work runs at once; one more is answered 503 before it reaches the store. */
const MAX_IN_FLIGHT = 8;

/** The largest body: an `asset.upload` of the largest asset, and room for the rest of the call. */
const MAX_BODY_BYTES = ASSET_BYTES_INPUT_MAX + 64 * 1024;

/**
 * Whom the listener answers, by what a request says of itself.
 *
 * - `hosts`: the `Host`s a request may name. On a TCP port, the listener's
 *   own names, so a page whose DNS name was rebound to the loopback address
 *   cannot reach it; on a socket, any (null), since only its owner's
 *   processes (and the proxy they run) can connect.
 * - `origins`: the `Origin`s a request may carry. A request that carries one
 *   is a browser's, and kb mcp serves no page, so only its own origin is
 *   taken: the TCP listener's names over http, and none on a socket. A
 *   request without one (any program, an edge forwarding a vendor's
 *   server-to-server call) is not a browser's and passes.
 */
interface Gate {
  readonly hosts: readonly string[] | null;
  readonly origins: readonly string[];
}

function gateOf(at: ServerListener, port: number | undefined): Gate {
  if (at.kind === "socket") return { hosts: null, origins: [] };
  const hosts = hostsOf(at, port ?? at.port);
  return { hosts, origins: hosts.map((host) => `http://${host}`) };
}

/** A JSON-RPC error answering no request id, as the transport answers one it refuses. */
function jsonRpcError(status: number, code: number, message: string): Response {
  return Response.json({ jsonrpc: "2.0", error: { code, message }, id: null }, { status });
}

/**
 * What a request is refused with before its body is read, or null: a path
 * other than {@link MCP_PATH}, a `Host` or an `Origin` the gate does not
 * take, a method other than POST, or a server already at
 * {@link MAX_IN_FLIGHT}.
 */
function refusalOf(request: Request, gate: Gate, inFlight: number): Response | null {
  if (new URL(request.url).pathname !== MCP_PATH) {
    return new Response("Not Found", { status: 404 });
  }
  if (gate.hosts !== null && !gate.hosts.includes(request.headers.get("host") ?? "")) {
    return new Response("Forbidden: this Host does not name the listener", { status: 403 });
  }
  const origin = request.headers.get("origin");
  if (origin !== null && !gate.origins.includes(origin)) {
    return new Response("Forbidden: kb mcp takes no request from a browser page", { status: 403 });
  }
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405, headers: { Allow: "POST" } });
  }
  if (inFlight >= MAX_IN_FLIGHT) {
    return jsonRpcError(503, -32000, `kb mcp is answering ${MAX_IN_FLIGHT} requests; retry`);
  }
  return null;
}

/** The one JSON-RPC message a body holds, or the error answering it: a batch is refused. */
function messageOf(body: string): { readonly message: unknown } | Response {
  let message: unknown;
  try {
    message = JSON.parse(body);
  } catch {
    return jsonRpcError(400, -32700, "Parse error: the body is not JSON");
  }
  return Array.isArray(message)
    ? jsonRpcError(400, -32600, "Invalid Request: one JSON-RPC message per request, not a batch")
    : { message };
}

/**
 * One admitted request, as the stateless transport answers it: its one
 * message, parsed here so a batch never reaches the SDK. A transport that
 * rejects is a defect, which the listener answers with a 500.
 */
const answer = Effect.fn("kb.mcp.answer")(function* (session: McpSession, request: Request) {
  const read = messageOf(yield* Effect.promise(() => request.text()));
  if (read instanceof Response) return read;
  const server = mcpServerOf(session, Effect.void);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  return yield* Effect.acquireUseRelease(
    Effect.promise(() => server.connect(transport)),
    () => Effect.promise(() => transport.handleRequest(request, { parsedBody: read.message })),
    () => Effect.promise(() => server.close()),
  );
});

/**
 * The Bun server for `session` at `where`, the SDK boundary every request
 * crosses. A request is refused before its body is read (`refusalOf`);
 * an admitted one is held by `requests` (kb ui's mechanism): answered 503
 * past its deadline, and tracked until it settles, so the root closes only
 * after the calls in flight. The idle timeout `listen` binds with covers
 * that deadline, which covers a write's wait for the store's lock, so a
 * connection is not dropped under a write that then commits with no one to
 * tell.
 */
function bunServe(
  where: BindOptions,
  session: McpSession,
  at: ServerListener,
  requests: ReturnType<typeof requestHealth>,
) {
  return Bun.serve({
    ...where,
    maxRequestBodySize: MAX_BODY_BYTES,
    fetch: (request, server) =>
      refusalOf(request, gateOf(at, server.port), requests.inFlight()) ??
      requests.run(request, MCP_PATH, (signal) =>
        Effect.runPromise(answer(session, request), { signal }),
      ),
  });
}

/** Serve `session` at `at` for as long as `lifetime` is open; the root closes last. */
const serveIn = Effect.fn("kb.mcp.serveIn")(function* (
  root: string,
  at: ServerListener,
  options: McpOptions,
  lifetime: Scope.Closeable,
) {
  const session = yield* openMcpSession(root, options);
  yield* Scope.addFinalizer(lifetime, session.ctx.store.closeEffect);
  // The sampler starts with the requests' holder, so it stops with the
  // lifetime even when the bind below fails; finalizers run last-first, so
  // the server stops before the requests settle.
  const requests = requestHealth((line) => writeErr(`kb mcp: ${line}`));
  yield* Scope.addFinalizer(
    lifetime,
    Effect.promise(() => requests.settle()),
  );
  const served = yield* listen(at, lifetime, (where) => bunServe(where, session, at, requests));
  yield* Scope.addFinalizer(
    lifetime,
    Effect.promise(() => served.stop(true)),
  );
  const bound: ServerListener = at.kind === "tcp" ? { ...at, port: served.port ?? at.port } : at;
  return { at: bound, stop: Scope.close(lifetime, Exit.void) };
});

/**
 * Serve the MCP server for `root` over Streamable HTTP at `address`
 * (`unix:<path>`, `127.0.0.1:<port>` or `[::1]:<port>`). An address another
 * machine could reach is refused: nothing here asks who calls.
 */
export const listenMcp = Effect.fn("kb.listenMcp")(function* (
  root: string,
  address: string,
  options: McpOptions = {},
): Effect.fn.Return<McpListening, DomainError, FileSystem> {
  const at = listenerOfAddress(address);
  if ("refused" in at) return yield* domainError("invalid_input", `--listen: ${at.refused}`);
  if (!onThisMachineOnly(at)) {
    return yield* domainError(
      "invalid_input",
      `--listen ${address}: kb mcp checks no credentials, so it listens only where this machine alone reaches it: unix:<path>, 127.0.0.1:<port> or [::1]:<port>`,
    );
  }
  return yield* Effect.acquireUseRelease(
    Effect.sync(() => Scope.makeUnsafe("sequential")),
    (lifetime) => serveIn(root, at, options, lifetime),
    (lifetime, exit) => (Exit.isFailure(exit) ? Scope.close(lifetime, exit) : Effect.void),
  );
}, Effect.provide(bunFileSystemLayer));

/** Where a running listener is reached, as a message names it. */
export function mcpAddressOf(at: ServerListener): string {
  if (at.kind === "socket") return `unix:${at.path} at ${MCP_PATH}`;
  const [host] = hostsOf(at, at.port);
  return `http://${host}${MCP_PATH}`;
}
