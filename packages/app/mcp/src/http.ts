/**
 * `kb mcp --listen` (DESIGN.md → Surfaces → MCP): the MCP server stdio
 * serves, over Streamable HTTP at {@link MCP_PATH}. Only the transport
 * differs: the tools, the resources and every call's wire are the session's
 * (`mcp.ts`), and a write is labelled with the `KB_VIA` the process was
 * started with, as on stdio.
 *
 * It is stateless: each POST gets a fresh SDK server and transport over the
 * one open root, answered as JSON. There is no session to resume and no
 * stream from the server, so GET and DELETE on the path are refused, and
 * every other path is not found.
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
} from "@kb/listener";
import { type DomainError, domainError } from "@kb/model";
import { bunFileSystemLayer, pendingRequests } from "@kb/runtime";
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

/**
 * The `Host`s a request may name: a TCP listener's own names, so a page
 * whose DNS name was rebound to the loopback address cannot reach it; on a
 * socket, any, since only its owner's processes (and the proxy they run)
 * can connect.
 */
function allowedHostsOf(at: ServerListener, port: number | undefined): readonly string[] | null {
  return at.kind === "tcp" ? hostsOf(at, port ?? at.port) : null;
}

/**
 * One request, as the stateless transport answers it. A transport that
 * rejects is a defect, which the listener answers with a 500.
 */
const answer = Effect.fn("kb.mcp.answer")(function* (
  session: McpSession,
  request: Request,
  hosts: readonly string[] | null,
) {
  if (new URL(request.url).pathname !== MCP_PATH) {
    return new Response("Not Found", { status: 404 });
  }
  if (hosts !== null && !hosts.includes(request.headers.get("host") ?? "")) {
    return new Response("Forbidden: this Host does not name the listener", { status: 403 });
  }
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405, headers: { Allow: "POST" } });
  }
  const server = mcpServerOf(session, Effect.void);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  return yield* Effect.acquireUseRelease(
    Effect.promise(() => server.connect(transport)),
    () => Effect.promise(() => transport.handleRequest(request)),
    () => Effect.promise(() => server.close()),
  );
});

/**
 * The Bun server for `session` at `where`, the SDK boundary every request
 * crosses: each answer is run to a promise, which `requests` holds until it
 * settles, so the root closes only after the calls in flight.
 */
function bunServe(
  where: BindOptions,
  session: McpSession,
  at: ServerListener,
  requests: ReturnType<typeof pendingRequests>,
) {
  return Bun.serve({
    ...where,
    fetch: (request, server) =>
      requests.run(() =>
        Effect.runPromise(answer(session, request, allowedHostsOf(at, server.port))),
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
  const requests = pendingRequests();
  const served = yield* listen(at, lifetime, (where) => bunServe(where, session, at, requests));
  yield* Scope.addFinalizer(
    lifetime,
    Effect.promise(() => served.stop(true).then(requests.settle)),
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
