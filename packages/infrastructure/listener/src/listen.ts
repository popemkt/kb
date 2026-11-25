/**
 * Binding a kb server where its `ServerListener` says: a TCP port on a host, or a
 * Unix socket only its owner can connect to. A socket is how a hosted
 * deployment keeps its proxy the one way in: the proxy (`tailscale serve`
 * as root, or an edge running as the socket's account) connects to it, and
 * no other account's process can (DESIGN.md → Action registry → Hosted
 * behind a proxy; Surfaces → MCP).
 */
import {
  chmodSync,
  lstatSync,
  realpathSync,
  renameSync,
  rmSync,
  unlinkSync,
  type Stats,
} from "node:fs";
import { createConnection } from "node:net";
import { basename, dirname, join, resolve } from "node:path";
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

/** A directory others may write in, but only remove their own entries from (`/tmp`). */
const STICKY = 0o1000;

/** Which part of the chain a directory is: the socket's own, or one above it. */
type Place = "parent" | "ancestor";

/**
 * Why `dir` could let another account replace what the path names, or null.
 * Every directory on the chain must be a real directory (not a link) that
 * no group or other can write. The socket's own directory is this user's;
 * one above it is this user's or root's, and may be root's and sticky, as
 * `/tmp` is, since a sticky directory lets no one else rename or remove
 * what this user made in it.
 */
function whyNotSafe(info: Stats, place: Place): string | null {
  const me = process.getuid?.() ?? info.uid;
  if (info.isSymbolicLink()) return "is a symbolic link";
  if (!info.isDirectory()) return "is not a directory";
  if (place === "parent" && info.uid !== me) return "is another user's";
  if (info.uid !== me && info.uid !== 0) return "is another user's, not root's";
  const sharedSticky = place === "ancestor" && info.uid === 0 && (info.mode & STICKY) !== 0;
  if ((info.mode & OTHERS_WRITE) !== 0 && !sharedSticky) {
    return "is writable by its group or others";
  }
  return null;
}

/**
 * Where to make the socket `requested` names, which is where it is
 * reported: its directory must already be canonical (its own `realpath`),
 * since a path through a link names whatever the link points to later, and
 * the address a server reports is what its clients connect to. Every
 * directory from there up to `/` is checked by `lstat` (`whyNotSafe`).
 */
const safeSocketPath = Effect.fn("kb.listen.safeSocketPath")(function* (requested: string) {
  const asked = dirname(resolve(requested));
  const real = yield* Effect.try({
    try: () => realpathSync(asked),
    catch: () => domainError("not_found", `${asked} does not exist`),
  });
  if (real !== asked) {
    return yield* domainError(
      "invalid_input",
      `${asked} reaches its directory through a link; name the socket by its real path: ${join(real, basename(requested))}`,
    );
  }
  const chain: string[] = [];
  for (let dir = real; ; dir = dirname(dir)) {
    chain.push(dir);
    if (dirname(dir) === dir) break;
  }
  for (const [index, dir] of chain.entries()) {
    const info = yield* entryAt(dir);
    const why =
      info === null ? "does not exist" : whyNotSafe(info, index === 0 ? "parent" : "ancestor");
    if (why !== null) {
      return yield* domainError(
        "forbidden",
        `a socket is made only where no other account can change its path: ${dir} ${why}`,
      );
    }
  }
  return join(real, basename(requested));
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
 * - is made only where no other account can change its path: its
 *   directory is canonical, with no link on the way, and every directory
 *   up to `/` is checked (`safeSocketPath`);
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
  const path = yield* safeSocketPath(at.path);
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
