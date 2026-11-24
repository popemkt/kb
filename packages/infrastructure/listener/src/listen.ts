/**
 * Binding a kb server where its `ServerListener` says: a TCP port on a host, or a
 * Unix socket only its owner can connect to. A socket is how a hosted
 * deployment keeps its proxy the one way in: the proxy (`tailscale serve`
 * as root, or an edge running as the socket's account) connects to it, and
 * no other account's process can (DESIGN.md → Action registry → Hosted
 * behind a proxy; Surfaces → MCP).
 */
import { chmodSync, lstatSync, renameSync, rmSync, unlinkSync, type Stats } from "node:fs";
import { createConnection } from "node:net";
import { dirname, join } from "node:path";
import { Effect, Scope } from "effect";
import type { ServerListener } from "@kb/contracts";
import { acquireFileWriteLockEffect, releaseFileWriteLock } from "@kb/file-write";
import { type DomainError, domainError } from "@kb/model";
import { HTTP_IDLE_TIMEOUT_SECONDS } from "./request-health.ts";

/**
 * What `Bun.serve` is told to bind, with the idle timeout every kb host's
 * requests are held to (`HTTP_IDLE_TIMEOUT_SECONDS`), which covers their
 * deadline.
 */
export type BindOptions = { hostname: string; port: number } | { unix: string };

/** `where`, carrying the idle timeout. */
function bindingOf(where: BindOptions): BindOptions {
  // GAP [[01M7X56KZ3QCBQTZ4KMEE7PNGA]] Bun accepts the idle timeout on Unix
  // listeners at runtime, but UnixServeOptions omits it (oven-sh/bun#43816).
  return Object.assign({ idleTimeout: HTTP_IDLE_TIMEOUT_SECONDS }, where);
}

/** Owner read and write, nobody else: connecting to a socket needs write. */
const SOCKET_MODE = 0o600;

/** Group or other write on a directory: whoever has it can swap the directory's entries. */
const OTHERS_WRITE = 0o022;

/** Which file a path held when this process bound it: a socket is its own only while both match. */
interface Made {
  readonly dev: number;
  readonly ino: number;
}

/** What `path` is, not following a link, or null when nothing is there. */
function entryAt(path: string): Effect.Effect<Stats | null, DomainError> {
  return Effect.try({
    try: () => lstatSync(path, { throwIfNoEntry: false }) ?? null,
    catch: (err) => domainError("internal", `cannot read ${path}: ${String(err)}`),
  });
}

/**
 * The directory a socket is made in must be its owner's alone: a real
 * directory (not a link), owned by this process's user, and writable by
 * nobody else. Then no other account can put a link or a socket of its own
 * at the path between a check and the bind, the chmod or the removal.
 */
function notOwnersAlone(dir: string, info: Stats | null): DomainError | null {
  if (info === null) return domainError("not_found", `${dir} does not exist`);
  const why = info.isSymbolicLink()
    ? "is a symbolic link"
    : !info.isDirectory()
      ? "is not a directory"
      : info.uid !== (process.getuid?.() ?? info.uid)
        ? "is another user's"
        : (info.mode & OTHERS_WRITE) !== 0
          ? "is writable by its group or others"
          : null;
  return why === null
    ? null
    : domainError(
        "forbidden",
        `a socket is made only in a directory its owner alone can change: ${dir} ${why}`,
      );
}

const ownedDirectory = Effect.fn("kb.listen.ownedDirectory")(function* (dir: string) {
  const refused = notOwnersAlone(dir, yield* entryAt(dir));
  return yield* refused === null ? Effect.void : Effect.fail(refused);
});

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
 * `use` while holding the socket's lock (`<path>.lock`, flock(2), released
 * by the kernel if this process dies), so two processes never claim, bind
 * or remove the same socket at once.
 */
function underLock<A>(path: string, use: Effect.Effect<A, DomainError>) {
  return Effect.acquireUseRelease(
    acquireFileWriteLockEffect(path),
    () => use,
    (lock) => Effect.sync(() => releaseFileWriteLock(lock)),
  );
}

/**
 * Whether `path` may take a new socket: nothing is there, or a stale
 * socket, which the bind's rename replaces. A link, a path that is not a
 * socket, or a socket anything accepts a connection on is refused, so
 * starting never takes over a running listener, whatever it speaks, or
 * replaces a file.
 */
const claim = Effect.fn("kb.listen.claim")(function* (path: string) {
  const info = yield* entryAt(path);
  const refused =
    info === null
      ? null
      : info.isSymbolicLink()
        ? `${path} is a symbolic link, not a socket`
        : !info.isSocket()
          ? `${path} exists and is not a socket`
          : (yield* stale(path))
            ? null
            : `a server already listens on ${path}`;
  return yield* refused === null ? Effect.void : Effect.fail(domainError("conflict", refused));
});

/** Bind names are pid + sequence, unique in this process and among live ones. */
let bindSeq = 0;

/**
 * Bind `serve` at a private name beside `path`, then rename it into place.
 *
 * - It is bound under a umask that leaves only its owner's bits, so it
 *   never exists with wider ones (the umask is the process's, and the bind
 *   is synchronous, so nothing else is created under it), then set to
 *   exactly owner read and write before anyone can reach it at `path`.
 * - The rename puts it at `path` in one step, replacing a stale socket
 *   there, so `path` never names nothing while a start replaces one.
 * - The server only knows the private name. Bun unlinks the name it bound
 *   when it stops, which is gone by then, so it never removes whatever
 *   `path` holds; that is `removeOwn`'s, by the socket's identity.
 *
 * A bind that fails throws, as a TCP one does.
 */
const bindSocket = Effect.fn("kb.listen.bindSocket")(function* <
  T extends { stop(force?: boolean): unknown },
>(path: string, serve: (where: BindOptions) => T) {
  bindSeq += 1;
  const bound = join(dirname(path), `.kb-${process.pid}-${bindSeq}`);
  yield* Effect.try({
    // The directory is its owner's alone, so a name of this process's pid is a dead one of ours.
    try: () => rmSync(bound, { force: true }),
    catch: (err) => domainError("internal", `cannot clear ${bound}: ${String(err)}`),
  });
  const previous = process.umask(0o777 & ~SOCKET_MODE);
  let served: T;
  try {
    served = serve(bindingOf({ unix: bound }));
  } finally {
    process.umask(previous);
  }
  return yield* Effect.try({
    try: (): Made => {
      const info = lstatSync(bound);
      if (!info.isSocket()) throw new Error(`${bound} is not the socket bound there`);
      chmodSync(bound, SOCKET_MODE);
      renameSync(bound, path);
      return { dev: info.dev, ino: info.ino };
    },
    catch: (err) => domainError("internal", `cannot put the socket at ${path}: ${String(err)}`),
  }).pipe(
    Effect.tapError(() =>
      Effect.sync(() => {
        served.stop(true);
        rmSync(bound, { force: true });
      }),
    ),
    Effect.map((made) => ({ served, made })),
  );
});

/** Remove the socket at `path` if it is still the one this process made. */
const removeOwn = Effect.fn("kb.listen.removeOwn")(function* (path: string, made: Made) {
  const info = yield* entryAt(path);
  if (info === null || info.dev !== made.dev || info.ino !== made.ino) return;
  yield* Effect.try({
    try: () => unlinkSync(path),
    catch: (err) => domainError("internal", `cannot remove ${path}: ${String(err)}`),
  });
});

/**
 * Bind `serve` where `at` says, for as long as `lifetime` is open. A TCP
 * bind is the port's. A socket:
 *
 * - is made only in a directory its owner alone can change
 *   (`ownedDirectory`);
 * - is claimed and bound under its lock, so two starts never race: one a
 *   stopped server left behind, which refuses a connection, is replaced;
 *   anything else there is refused (`claim`);
 * - exists only with owner read and write, and reaches `path` by an
 *   atomic rename (`bindSocket`);
 * - is removed when `lifetime` closes, under the lock, and only while the
 *   path still holds the socket this process made: one a later start put
 *   there after this server stopped is that start's.
 */
export const listen = Effect.fn("kb.listen")(function* <
  T extends { stop(force?: boolean): unknown },
>(
  at: ServerListener,
  lifetime: Scope.Closeable,
  serve: (where: BindOptions) => T,
): Effect.fn.Return<T, DomainError> {
  if (at.kind === "tcp") return serve(bindingOf({ hostname: at.hostname, port: at.port }));
  const { path } = at;
  yield* ownedDirectory(dirname(path));
  const { served, made } = yield* underLock(
    path,
    Effect.gen(function* () {
      yield* claim(path);
      return yield* bindSocket(path, serve);
    }),
  );
  yield* Scope.addFinalizer(lifetime, underLock(path, removeOwn(path, made)).pipe(Effect.ignore));
  return served;
});
