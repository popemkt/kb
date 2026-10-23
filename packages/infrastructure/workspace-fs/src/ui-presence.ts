import { isAbsolute, resolve } from "node:path";
import { Effect, Option, Predicate, Schema } from "effect";
import { FileSystem } from "effect/FileSystem";
import {
  ServerIdentitySchema,
  isLoopbackHost,
  uiAddressOf,
  uiListenerName,
  type UiListener,
} from "@kb/contracts";
import { domainError, type DomainError } from "@kb/model";
import { internal, isNotFound } from "./errors.ts";

/**
 * `.kb/ui.json`: which `kb ui` serves this root, while one does. The server
 * writes it once it listens and removes it when it stops; a process that
 * needs the server for its root (the CLI or MCP asking for the screen) reads
 * it. It is runtime state, like a pidfile: never committed, never backed up,
 * readable by its owner only. It names where the server listens (its
 * `UiListener`, a TCP port or a Unix socket), and a reader reaches the
 * server there (`requestUi`). A file left by a server that died names a
 * listener nothing answers on any more, or one another root's server now
 * holds, so a reader asks the server which root it serves before it trusts
 * the file. The file is only a file in the root, so whatever wrote it, it
 * names a server on this machine or nothing (`PresentListenerSchema`).
 */
function uiPresenceFile(root: string): string {
  return resolve(root, ".kb", "ui.json");
}

/**
 * Whether `url` is where a `kb ui` on this machine answers: the bare origin
 * of plain `http` to a loopback host on an explicit port, with no
 * credentials, path, query or fragment. A reader goes to nothing else, so a
 * presence file written by anyone but a server (a checkout, a tool) cannot
 * send a probe, a call or the page anywhere else.
 */
function isUiOrigin(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return (
    parsed.protocol === "http:" &&
    isLoopbackHost(parsed.hostname) &&
    parsed.port !== "" &&
    parsed.origin === url
  );
}

/** Whether `url` is the bare origin of an `http` or `https` page: where a proxy serves a socket's page. */
function isPageOrigin(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return (parsed.protocol === "http:" || parsed.protocol === "https:") && parsed.origin === url;
}

/**
 * A listener a process on this machine reaches: a TCP listener whose
 * address is a `kb ui` on this machine (`isUiOrigin`), or a Unix socket at
 * an absolute path, on this machine by being a path, whose page is the bare
 * origin of its proxy. A socket is its owner's alone (mode 0600), so only a
 * process of the account that serves it gets through.
 */
const PresentListenerSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("tcp"),
    hostname: Schema.String,
    port: Schema.Int,
  }).check(Schema.makeFilter((at) => isUiOrigin(uiAddressOf(at)) || "not a kb ui on this machine")),
  Schema.Struct({
    kind: Schema.Literal("socket"),
    path: Schema.String.check(
      Schema.makeFilter((path) => isAbsolute(path) || "not an absolute socket path"),
    ),
    origin: Schema.String.check(
      Schema.makeFilter((origin) => isPageOrigin(origin) || "not a page origin"),
    ),
  }),
]);

const PresenceSchema = Schema.Struct({
  at: PresentListenerSchema,
  pid: Schema.Finite,
  root: Schema.String,
});
export type UiPresence = typeof PresenceSchema.Type;

const decodePresence = Schema.decodeUnknownOption(Schema.fromJsonString(PresenceSchema));
const isPresentListener = Schema.is(PresentListenerSchema);

/** The root as a server names it: absolute, with its symlinks resolved. */
export const canonicalRoot = Effect.fn("kb.uiPresence.canonicalRoot")(function* (
  root: string,
): Effect.fn.Return<string, never, FileSystem> {
  const fs = yield* FileSystem;
  return yield* fs.realPath(root).pipe(Effect.orElseSucceed(() => resolve(root)));
});

/** Record that the `kb ui` listening `at`, this process, serves `root`. */
export const writeUiPresence = Effect.fn("kb.uiPresence.write")(function* (
  root: string,
  at: UiListener,
): Effect.fn.Return<void, DomainError, FileSystem> {
  if (!isPresentListener(at))
    return yield* domainError(
      "invalid_input",
      `.kb/ui.json names only a kb ui on this machine (http://127.0.0.1:<port>, or a socket at an absolute path with its page origin), not ${uiListenerName(at)}`,
    );
  const fs = yield* FileSystem;
  const file = uiPresenceFile(root);
  const presence: UiPresence = { at, pid: process.pid, root: yield* canonicalRoot(root) };
  return yield* fs
    .writeFileString(file, `${JSON.stringify(presence)}\n`, { mode: 0o600 })
    // The mode applies only to a file this write creates; one left behind keeps its own.
    .pipe(
      Effect.andThen(fs.chmod(file, 0o600)),
      Effect.mapError((err) => internal("write .kb/ui.json", err)),
    );
});

/**
 * What `.kb/ui.json` says, or null when there is none or it is not one this
 * module would write: a listener that is not a `kb ui` on this machine
 * included.
 */
export const readUiPresence = Effect.fn("kb.uiPresence.read")(function* (
  root: string,
): Effect.fn.Return<UiPresence | null, DomainError, FileSystem> {
  const fs = yield* FileSystem;
  const text = yield* fs
    .readFileString(uiPresenceFile(root))
    .pipe(
      Effect.catch((err) =>
        isNotFound(err) ? Effect.succeed(null) : Effect.fail(internal("read .kb/ui.json", err)),
      ),
    );
  if (text === null) return null;
  return Option.getOrNull(decodePresence(text));
});

/**
 * A request to `path` on the `kb ui` listening `at`, from a process on this
 * machine: the one way every reader of presence reaches the server it
 * names. Over a socket it names `localhost`, as the socket's proxy does.
 * It carries no Origin either way, so the server takes it as a local
 * program's.
 */
export function requestUi(at: UiListener, path: string, init: RequestInit = {}): Promise<Response> {
  return at.kind === "tcp"
    ? fetch(`${uiAddressOf(at)}${path}`, init)
    : fetch(`http://localhost${path}`, { ...init, unix: at.path });
}

/**
 * Whether a `requestUi` failed because nothing listens where it went: a
 * TCP connection refused (Bun's and Node's codes), or a socket that is gone
 * or nobody listens on any more.
 */
export function nothingListens(cause: unknown): boolean {
  if (!Predicate.hasProperty(cause, "code")) return false;
  return (
    cause.code === "ConnectionRefused" ||
    cause.code === "ECONNREFUSED" ||
    cause.code === "FailedToOpenSocket" ||
    cause.code === "ENOENT"
  );
}

/** How long the server named in `.kb/ui.json` gets to say which root it serves. */
const PROBE_MS = 500;

/**
 * Where the `kb ui` that serves `root` now listens, or null. The presence
 * file only says where one was: the server there is asked which root it
 * serves and where its page is, briefly, and anything short of this root's
 * own answer with the file's own page (no file, nothing listening, too
 * slow, another root, another page) means no server. The page a reader
 * opens is the server's word, then, not the file's.
 */
export const servingUi = Effect.fn("kb.uiPresence.serving")(function* (
  root: string,
): Effect.fn.Return<UiListener | null, DomainError, FileSystem> {
  const presence = yield* readUiPresence(root);
  if (presence === null) return null;
  const expected = yield* canonicalRoot(root);
  const identity = yield* Effect.tryPromise((signal) =>
    requestUi(presence.at, "/api/identity", { signal }),
  ).pipe(
    Effect.flatMap((res) => Effect.tryPromise(() => res.json())),
    Effect.map((body) => ServerIdentitySchema.safeParse(body)),
    Effect.timeoutOption(PROBE_MS),
    Effect.orElseSucceed(() => Option.none()),
  );
  if (Option.isNone(identity) || !identity.value.success) return null;
  // The file says only where to knock; the server says what it is. Its root
  // and its page must both be the file's, so a file that names the right
  // server with another page (a socket's origin swapped) is no server.
  const { root: served, page } = identity.value.data;
  return served === expected && page === uiAddressOf(presence.at) ? presence.at : null;
});

/** Whether `a` and `b` are one listener. */
function sameListener(a: UiListener, b: UiListener): boolean {
  if (a.kind === "tcp") return b.kind === "tcp" && a.hostname === b.hostname && a.port === b.port;
  return b.kind === "socket" && a.path === b.path && a.origin === b.origin;
}

/**
 * Forget that the `kb ui` listening `at`, this process, serves `root`:
 * remove the file, unless a later server over the same root has since
 * written its own. A port or a socket path is reused once its server is
 * gone, so the listener alone does not say whose the file is; the listener and the
 * process together do.
 */
export const clearUiPresence = Effect.fn("kb.uiPresence.clear")(function* (
  root: string,
  at: UiListener,
): Effect.fn.Return<void, DomainError, FileSystem> {
  const presence = yield* readUiPresence(root);
  if (presence === null || !sameListener(presence.at, at) || presence.pid !== process.pid) return;
  const fs = yield* FileSystem;
  yield* fs
    .remove(uiPresenceFile(root))
    .pipe(
      Effect.catch((err) =>
        isNotFound(err) ? Effect.void : Effect.fail(internal("remove .kb/ui.json", err)),
      ),
    );
});
