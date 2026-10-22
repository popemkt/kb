import { resolve } from "node:path";
import { Effect, Option, Schema } from "effect";
import { FileSystem } from "effect/FileSystem";
import { ServerIdentitySchema, isLoopbackHost, uiAddressOf, type UiListener } from "@kb/contracts";
import { domainError, type DomainError } from "@kb/model";
import { internal, isNotFound } from "./errors.ts";

/**
 * `.kb/ui.json`: which `kb ui` serves this root, while one does. The server
 * writes it once it listens and removes it when it stops; a process that
 * needs the server for its root (the CLI or MCP asking for the screen) reads
 * it. It is runtime state, like a pidfile: never committed, never backed up,
 * readable by its owner only. It names where the server listens (its
 * `UiListener`), and a reader reaches the server there (`requestUi`). A
 * file left by a server that died names a listener nothing answers on any
 * more, or one another root's server now holds, so a reader asks the server
 * which root it serves before it trusts the file. The file is only a file
 * in the root, so whatever wrote it, it names a server on this machine or
 * nothing (`isUiOrigin`).
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

/** A TCP listener whose address is a `kb ui` on this machine (`isUiOrigin`). */
const PresentListenerSchema = Schema.Struct({
  kind: Schema.Literal("tcp"),
  hostname: Schema.String,
  port: Schema.Int,
}).check(Schema.makeFilter((at) => isUiOrigin(uiAddressOf(at)) || "not a kb ui on this machine"));

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
      `.kb/ui.json names only a kb ui on this machine (http://127.0.0.1:<port>), not ${uiAddressOf(at)}`,
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
 * names. It carries no Origin, so the server takes it as a local program's.
 */
export function requestUi(at: UiListener, path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${uiAddressOf(at)}${path}`, init);
}

/** How long the server named in `.kb/ui.json` gets to say which root it serves. */
const PROBE_MS = 500;

/**
 * Where the `kb ui` that serves `root` now listens, or null. The presence
 * file only says where one was: the server there is asked which root it
 * serves, briefly, and anything short of this root's own answer (no file,
 * nothing listening, too slow, another root) means no server.
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
  return identity.value.data.root === expected ? presence.at : null;
});

/** Whether `a` and `b` are one listener. */
function sameListener(a: UiListener, b: UiListener): boolean {
  if (a.kind === "tcp") return b.kind === "tcp" && a.hostname === b.hostname && a.port === b.port;
  return b.kind === "socket" && a.path === b.path && a.origin === b.origin;
}

/**
 * Forget that the `kb ui` listening `at`, this process, serves `root`:
 * remove the file, unless a later server over the same root has since
 * written its own. A port is reused once its server is gone, so the
 * listener alone does not say whose the file is; the listener and the
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
