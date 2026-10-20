/**
 * Where a `kb ui` server listens (DESIGN.md → Action registry → Hosted behind a
 * proxy): a TCP port on a host, or a Unix socket only its owner can
 * connect to. A socket is how a hosted deployment keeps its proxy the one
 * way in: the proxy (`tailscale serve`, run as root) connects to it, and no
 * other account's process can, so a header the proxy sets is the proxy's.
 */
import { createConnection } from "node:net";
import { Effect, Scope } from "effect";
import { FileSystem } from "effect/FileSystem";
import { type DomainError, domainError } from "@kb/model";

export type Listener =
  | { readonly kind: "tcp"; readonly hostname: string; readonly port: number }
  | {
      readonly kind: "socket";
      readonly path: string;
      /** The proxy's public origin, the one way to the socket and where its page is. */
      readonly origin: string;
    };

/** Where the page is: the TCP listener's own address, or the socket's proxy. */
export function addressOf(at: Listener): string {
  return at.kind === "tcp" ? `http://${at.hostname}:${at.port}` : at.origin;
}

/**
 * Where a process on this machine reaches the server, as `.kb/ui.json`
 * records it for the CLI and `kb mcp`: the TCP listener's address. A
 * socket has none it can record, so a socket server writes no presence.
 */
// GAP [[01M5CMVS78WRBD760MNSS3BMJJ]]
export function localUrlOf(at: Listener): string | null {
  return at.kind === "tcp" ? addressOf(at) : null;
}

/** What `Bun.serve` is told to bind. */
export type BindOptions = { hostname: string; port: number } | { unix: string };

/** Owner read and write, nobody else: connecting to a socket needs write. */
const SOCKET_MODE = 0o600;

/**
 * Whether the socket at `path` is stale: a connection to it is refused, so
 * nothing listens. Anything else — a listener that accepts, whatever it
 * then says or does not say, or a connection that fails for another
 * reason — leaves the socket someone's, and it is not taken over.
 */
function stale(path: string): Effect.Effect<boolean> {
  return Effect.callback<boolean>((resume) => {
    const probe = createConnection({ path });
    probe.once("connect", () => {
      probe.destroy();
      resume(Effect.succeed(false));
    });
    probe.once("error", (error: NodeJS.ErrnoException) => {
      probe.destroy();
      resume(Effect.succeed(error.code === "ECONNREFUSED"));
    });
  });
}

/**
 * Bind `serve` where `at` says, for as long as `lifetime` is open. A TCP
 * bind is the port's. A socket:
 *
 * - is claimed first: one a stopped server left behind, which refuses a
 *   connection, is removed; one anything accepts a connection on, or a
 *   path that is not a socket, is refused, so starting never takes over a
 *   running listener, whatever it speaks, or deletes a file;
 * - is created under a umask that leaves only its owner's bits, so it never
 *   exists with wider ones (the umask is the process's, and the bind is
 *   synchronous, so nothing else is created under it), then set to exactly
 *   owner read and write;
 * - is removed when `lifetime` closes.
 */
export const listen = Effect.fn("kb.listen")(function* <
  T extends { stop(force?: boolean): unknown },
>(
  at: Listener,
  lifetime: Scope.Closeable,
  serve: (where: BindOptions) => T,
): Effect.fn.Return<T, DomainError, FileSystem> {
  if (at.kind === "tcp") return serve({ hostname: at.hostname, port: at.port });
  const fs = yield* FileSystem;
  const failed = (doing: string) => (err: { message: string }) =>
    domainError("internal", `cannot ${doing} ${at.path}: ${err.message}`);

  const info = yield* fs.stat(at.path).pipe(Effect.orElseSucceed(() => null));
  if (info !== null) {
    if (info.type !== "Socket") {
      return yield* domainError("conflict", `${at.path} exists and is not a socket`);
    }
    if (!(yield* stale(at.path))) {
      return yield* domainError("conflict", `a server already listens on ${at.path}`);
    }
    yield* fs.remove(at.path).pipe(Effect.mapError(failed("remove the stale socket")));
  }

  // A bind that fails throws, as a TCP one does.
  const previous = process.umask(0o777 & ~SOCKET_MODE);
  let served: T;
  try {
    served = serve({ unix: at.path });
  } finally {
    process.umask(previous);
  }
  yield* Scope.addFinalizer(lifetime, fs.remove(at.path).pipe(Effect.ignore));
  yield* fs.chmod(at.path, SOCKET_MODE).pipe(
    Effect.mapError(failed("restrict to its owner")),
    Effect.tapError(() => Effect.sync(() => void served.stop(true))),
  );
  return served;
});
