/**
 * Binding a `kb ui` server where its `UiListener` says (DESIGN.md → Action
 * registry → Hosted behind a proxy): a TCP port on a host, or a Unix socket
 * only its owner can connect to. A socket is how a hosted deployment keeps
 * its proxy the one way in: the proxy (`tailscale serve`, run as root)
 * connects to it, and no other account's process can, so a header the proxy
 * sets is the proxy's.
 */
import { createConnection } from "node:net";
import { Effect, Exit, Scope } from "effect";
import { FileSystem } from "effect/FileSystem";
import type { UiListener } from "@kb/contracts";
import { type DomainError, domainError } from "@kb/model";

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
    return Effect.sync(() => {
      probe.destroy();
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
interface BoundListener {
  stop(force?: boolean): unknown;
}
interface ListenerBinding<T> {
  readonly create: () => T;
  readonly close: (listener: T) => Effect.Effect<void>;
  readonly ready: Effect.Effect<void, DomainError>;
}
const stop = Effect.fn("kb.listener.stop")(function* (listener: BoundListener) {
  yield* Effect.promise(() => Promise.resolve(listener.stop(true)));
});

/** Preflight remains cancellable; only the returned synchronous constructor will be masked. */
const bindingOf = Effect.fn("kb.listener.bindingOf")(function* <T extends BoundListener>(
  at: UiListener,
  serve: (where: BindOptions) => T,
): Effect.fn.Return<ListenerBinding<T>, DomainError, FileSystem> {
  if (at.kind === "tcp")
    return {
      create: () => serve({ hostname: at.hostname, port: at.port }),
      close: stop,
      ready: Effect.void,
    };
  const fs = yield* FileSystem;
  const failed = (doing: string) => (err: { message: string }) =>
    domainError("internal", `cannot ${doing} ${at.path}: ${err.message}`);
  const info = yield* fs.stat(at.path).pipe(Effect.orElseSucceed(() => null));
  if (info !== null) {
    if (info.type !== "Socket")
      return yield* domainError("conflict", `${at.path} exists and is not a socket`);
    if (!(yield* stale(at.path)))
      return yield* domainError("conflict", `a server already listens on ${at.path}`);
    yield* fs.remove(at.path).pipe(Effect.mapError(failed("remove the stale socket")));
  }
  return {
    create: () => {
      const previous = process.umask(0o777 & ~SOCKET_MODE);
      try {
        return serve({ unix: at.path });
      } finally {
        process.umask(previous);
      }
    },
    close: (listener) =>
      stop(listener).pipe(Effect.ensuring(fs.remove(at.path).pipe(Effect.ignore))),
    ready: fs.chmod(at.path, SOCKET_MODE).pipe(Effect.mapError(failed("restrict to its owner"))),
  };
});

/** Own the bound resource before asynchronous setup; unsuccessful setup closes only that resource. */
export const listen = Effect.fn("kb.listen")(function* <T extends BoundListener>(
  at: UiListener,
  lifetime: Scope.Closeable,
  serve: (where: BindOptions) => T,
) {
  const binding = yield* bindingOf(at, serve);
  const owned = yield* Scope.fork(lifetime);
  return yield* Effect.gen(function* () {
    const listener = yield* Effect.acquireRelease(Effect.sync(binding.create), binding.close).pipe(
      Effect.provideService(Scope.Scope, owned),
    );
    yield* binding.ready;
    return listener;
  }).pipe(Effect.onExit((exit) => (Exit.isFailure(exit) ? Scope.close(owned, exit) : Effect.void)));
});
