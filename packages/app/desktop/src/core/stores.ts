/**
 * The stores the desktop opens, by name. A local store is a location in the
 * person's home store (DESIGN.md → Locations): listing is `location.list`,
 * adding is `location.register`, and opening is `location.open`, which
 * answers the URL of the `kb ui` serving the root and starts one when none
 * does. So reusing a running host, and starting one on any free port, is
 * kb's own mechanism (`serveRoot`), not a second one here. A remote store
 * is an origin kept in the desktop's settings, paired once with its host
 * (`capture.pair`), its credential in the platform keychain.
 *
 * What the desktop adds is ownership: a host it had to start is its to stop
 * when it quits, and one that was already serving is left alone. Ownership
 * is of one process, not of a root: the host is known by the presence it
 * wrote when it started (its pid and its listener), and a host that has
 * since been replaced by another one for the same root is not this app's.
 */
import { existsSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { Context, Effect, Layer, Option, Schema, Semaphore } from "effect";
import { BunFileSystem } from "@effect/platform-bun";
import { CAPTURE_PAIR_CODE } from "@kb/contracts";
import { currentHome, readUiPresence, servingUi, type UiPresence } from "@kb/workspace-fs";
import type { DesktopConfig, RemoteStore } from "./config.ts";
import type { Keychain, KeychainItem } from "@kb/keychain";
import { PAIR_AGAIN, type PairWithHost } from "./capture.ts";
import type { KbRunner, Receipt } from "./kb-command.ts";
import { CaptureClient, CredentialKeychain, DeviceSettings, KbCli } from "./services.ts";

/** Why a store could not be listed, opened, added or forgotten, in words a person reads. */
export class StoreError extends Schema.TaggedError<StoreError>()("kb.desktop/StoreError", {
  message: Schema.String,
}) {}

const LOCAL_STATUSES = ["served", "closed", "missing", "not-a-store", "broken"] as const;
/** A status `location.list` gives a local store. */
export type LocalStatus = (typeof LOCAL_STATUSES)[number];

export type Store =
  | {
      readonly kind: "local";
      /** The location's node id in the home store. */
      readonly key: string;
      readonly name: string;
      readonly root: string;
      readonly status: LocalStatus;
    }
  | ({ readonly kind: "remote" } & RemoteStore);

/** A `location.list` row, as much of it as the desktop reads. */
const LocationRowSchema = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  path: Schema.String,
  status: Schema.Literals(LOCAL_STATUSES),
});
const decodeRow = Schema.decodeUnknownOption(LocationRowSchema);
const decodeRows = Schema.decodeUnknownOption(
  Schema.Struct({ rows: Schema.Array(Schema.Unknown) }),
);
const decodeOpened = Schema.decodeUnknownOption(Schema.Struct({ url: Schema.String }));

/** The local stores in a `location.list` output; a row the desktop cannot read is left out. */
export function locationStores(output: unknown): Store[] {
  const listed = Option.match(decodeRows(output), { onNone: () => [], onSome: ({ rows }) => rows });
  return listed.flatMap((raw): Store[] =>
    Option.match(decodeRow(raw), {
      onNone: () => [],
      onSome: (row) => [
        { kind: "local", key: row.id, name: row.label, root: row.path, status: row.status },
      ],
    }),
  );
}

/**
 * The store `keyOrName` names: by key, else by name as a person types it
 * (resolved once, here, at the entry point; everything after holds the key).
 */
export function findStore(stores: readonly Store[], keyOrName: string): Store | undefined {
  const folded = keyOrName.toLowerCase();
  return (
    stores.find((s) => s.key === keyOrName) ?? stores.find((s) => s.name.toLowerCase() === folded)
  );
}

/** The bare origin a store window may load, from what a person typed: https, or http to loopback. */
export function remoteOrigin(input: string): string | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) return null;
  return url.origin;
}

/** The keychain item that holds the credential of the remote store `key`. */
function credentialItem(key: string): KeychainItem {
  return { service: "kb-desktop", account: key };
}

/** A pairing code as `capture.pairCode` issues it: 32 lowercase hex characters. */
const PAIR_CODE = /^[a-f0-9]{32}$/;

/** What this device is called at a host it pairs with. */
const DEVICE_NAME = `kb desktop on ${hostname()}`;

/** A receipt's output, or the refusal as a StoreError that says what was asked. */
function succeeded(receipt: Receipt, asked: string): Effect.Effect<unknown, StoreError> {
  return receipt.status === "succeeded"
    ? Effect.succeed(receipt.output)
    : Effect.fail(new StoreError({ message: `${asked}: ${receipt.message}` }));
}

/** Whether kb finds a server answering for `root` now. */
function isServed(root: string): Effect.Effect<boolean> {
  return servingUi(root).pipe(
    Effect.map((at) => at !== null),
    Effect.provide(BunFileSystem.layer),
    Effect.orElseSucceed(() => false),
  );
}

/** What `root`'s presence says now, or null. */
function presenceOf(root: string): Effect.Effect<UiPresence | null> {
  return readUiPresence(root).pipe(
    Effect.provide(BunFileSystem.layer),
    Effect.orElseSucceed(() => null),
  );
}

/** One host process: its pid and where it listens, as its presence names them. */
interface HostIdentity {
  readonly pid: number;
  readonly listener: string;
}

function identityOf(presence: UiPresence): HostIdentity {
  return { pid: presence.pid, listener: JSON.stringify(presence.at) };
}

function sameHost(a: HostIdentity, b: HostIdentity): boolean {
  return a.pid === b.pid && a.listener === b.listener;
}

/** Send `sig` to `pid` (0 only asks), and answer whether it was there to receive it. */
function signal(pid: number, sig: NodeJS.Signals | 0): boolean {
  try {
    process.kill(pid, sig);
    return true;
  } catch {
    return false;
  }
}

export interface Stores {
  /** Every store: the home store's locations, then the remote ones. */
  readonly list: Effect.Effect<Store[], StoreError>;
  readonly find: (keyOrName: string) => Effect.Effect<Store | undefined, StoreError>;
  /**
   * The origin of the page that serves `store`: a remote store's origin, or
   * the URL `location.open` answers for a local one (started when nothing
   * serves it, and then this app's to stop).
   */
  readonly origin: (store: Store) => Effect.Effect<string, StoreError>;
  /** Add the kb root at `path` as a location named `name`, making a store there when there is none. */
  readonly addLocal: (path: string, name: string) => Effect.Effect<void, StoreError>;
  /**
   * Pair with the host at `origin` with the one-use `code` its owner issued
   * (`capture.pairCode`), keep the credential in the keychain, and add the
   * store, named `name` or as its host names it. Pairing an origin already
   * added pairs it again: a new credential under the same key.
   */
  readonly addRemote: (
    name: string,
    origin: string,
    code: string,
  ) => Effect.Effect<RemoteStore, StoreError>;
  /** The credential to send a capture to `store` with: a remote store's from the keychain, none for a local one. */
  readonly credential: (store: Store) => Effect.Effect<string | undefined, StoreError>;
  /** Forget `store`: a location leaves the home store (its directory is never touched); a remote leaves the settings and its credential the keychain. */
  readonly remove: (store: Store) => Effect.Effect<void, StoreError>;
  /** The roots whose hosts this app started and has not stopped. */
  readonly started: () => readonly string[];
  /**
   * Stop the host this app started for `root`, when that same process still
   * serves it: SIGTERM, then SIGKILL after a grace. A host that has replaced
   * it (another pid or listener in the presence) is someone else's and is
   * never signalled. kb ui commits each write before it answers it, so a host with no
   * request in flight has nothing left to settle; the caller closes the
   * root's windows and waits for its own captures first.
   */
  readonly stopStarted: (root: string) => Effect.Effect<void>;
}

const STOP_GRACE = "5 seconds";

/**
 * The paired remote stores: adding one pairs it (`capture.pair`) and keeps
 * its credential in the keychain under its key, a capture reads it from
 * there, and forgetting one takes it out of both the settings and the
 * keychain.
 */
function remoteStores(config: DesktopConfig, pair: PairWithHost, keychain: Keychain) {
  const mutation = Semaphore.makeUnsafe(1);
  const add = Effect.fn("kb.desktop.stores.addRemote")(
    function* (name: string, at: string, code: string) {
      const bare = remoteOrigin(at);
      if (bare === null)
        return yield* new StoreError({
          message: `${at} is not an https origin (or a loopback http one)`,
        });
      const typed = code.trim().toLowerCase();
      if (!PAIR_CODE.test(typed))
        return yield* new StoreError({
          message: `a pairing code is 32 hex characters; issue one on the store's host with: kb --root <store> --json action-invoke '{"id":"${CAPTURE_PAIR_CODE}"}'`,
        });
      const paired = yield* pair(bare, typed, DEVICE_NAME);
      if (!paired.ok)
        return yield* new StoreError({ message: `could not pair with ${bare}: ${paired.message}` });
      const before = config.settings.remotes.find((r) => r.origin === bare);
      const key = before?.key ?? `remote-${crypto.randomUUID().slice(0, 8)}`;
      yield* keychain.write(credentialItem(key), paired.token).pipe(
        Effect.mapError(
          (err) =>
            new StoreError({
              message: `paired, but the credential was not kept: ${err.message}`,
            }),
        ),
      );
      const remote: RemoteStore = {
        key,
        name: name === "" ? (before?.name ?? paired.store.name) : name,
        origin: bare,
        deviceId: paired.deviceId,
        // GAP [[01M7WZGP3B84JK08R43Y642C7N]]: the contract is read here, at pairing, and not from kb.manifest after.
        accepts: paired.accepts,
      };
      config.updateSettings((s) => ({
        ...s,
        remotes:
          before === undefined
            ? [...s.remotes, remote]
            : s.remotes.map((r) => (r.key === key ? remote : r)),
      }));
      return remote;
    },
    (effect) => mutation.withPermit(effect),
  );

  const credential = Effect.fn("kb.desktop.stores.credential")(function* (store: Store) {
    if (store.kind === "local") return undefined;
    if (store.deviceId === undefined)
      return yield* new StoreError({ message: `${store.name} needs pairing. ${PAIR_AGAIN}` });
    const token = yield* keychain.read(credentialItem(store.key)).pipe(
      Effect.mapError(
        (err) =>
          new StoreError({
            message: `${store.name}'s credential could not be read: ${err.message}`,
          }),
      ),
    );
    if (token === null)
      return yield* new StoreError({
        message: `${store.name} has no credential in the keychain. ${PAIR_AGAIN}`,
      });
    return token;
  });

  const forget = Effect.fn("kb.desktop.stores.forgetRemote")(
    function* (store: Extract<Store, { kind: "remote" }>) {
      yield* keychain.erase(credentialItem(store.key)).pipe(
        Effect.mapError(
          (err) =>
            new StoreError({
              message: `Could not forget ${store.name}: its keychain credential could not be erased (${err.message}). Try Forget again.`,
            }),
        ),
      );
      config.updateSettings((s) => ({
        ...s,
        remotes: s.remotes.filter((r) => r.key !== store.key),
      }));
    },
    (effect) => mutation.withPermit(effect),
  );

  return { add, credential, forget };
}

function storeDirectory(
  kb: KbRunner,
  config: DesktopConfig,
  pair: PairWithHost,
  keychain: Keychain,
): Stores {
  /** The host this app started for each root, so quitting stops those processes and nothing else. */
  const started = new Map<string, HostIdentity>();
  const remotes = remoteStores(config, pair, keychain);

  const list = Effect.gen(function* () {
    const home = yield* currentHome;
    const local = existsSync(join(home, ".kb"))
      ? locationStores(yield* succeeded(yield* kb.run(home, ["locations"]), "kb locations"))
      : [];
    const remote = config.settings.remotes.map((r): Store => ({ kind: "remote", ...r }));
    return [...local, ...remote];
  });

  const origin = Effect.fn("kb.desktop.stores.origin")(function* (store: Store) {
    if (store.kind === "remote") return store.origin;
    const wasServed = yield* isServed(store.root);
    const home = yield* currentHome;
    const output = yield* succeeded(
      yield* kb.run(home, ["open", store.key, "--no-browser"]),
      `could not open ${store.name}`,
    );
    const opened = Option.getOrUndefined(decodeOpened(output));
    if (opened === undefined || opened.url === "")
      return yield* new StoreError({ message: `kb open answered no URL for ${store.name}` });
    if (!wasServed) {
      // The host kb just started, known by the presence it wrote; without one
      // there is no process to call this app's, so none is recorded.
      const presence = yield* presenceOf(store.root);
      if (presence !== null) started.set(store.root, identityOf(presence));
    }
    return new URL(opened.url).origin;
  });

  const addLocal = Effect.fn("kb.desktop.stores.addLocal")(function* (path: string, name: string) {
    if (!existsSync(join(path, ".kb")))
      yield* succeeded(yield* kb.run(path, ["init"]), `kb init ${path}`);
    const label = name === "" ? [] : ["--label", name];
    yield* succeeded(
      yield* kb.run(path, ["locations", "add", path, ...label]),
      `could not add ${path}`,
    );
  });

  const remove = Effect.fn("kb.desktop.stores.remove")(function* (store: Store) {
    if (store.kind === "remote") {
      yield* remotes.forget(store);
      return;
    }
    const home = yield* currentHome;
    yield* succeeded(
      yield* kb.run(home, ["locations", "forget", store.key]),
      `could not forget ${store.name}`,
    );
  });

  const stopStarted = Effect.fn("kb.desktop.stores.stopStarted")(function* (root: string) {
    const owned = started.get(root);
    started.delete(root);
    if (owned === undefined || !(yield* isServed(root))) return;
    const presence = yield* presenceOf(root);
    if (presence === null || !sameHost(identityOf(presence), owned)) return;
    const { pid } = owned;
    if (!signal(pid, "SIGTERM")) return;
    const exited = yield* Effect.gen(function* () {
      while (signal(pid, 0)) yield* Effect.sleep("100 millis");
    }).pipe(Effect.timeoutOption(STOP_GRACE));
    if (Option.isNone(exited)) signal(pid, "SIGKILL");
  });

  return {
    list,
    find: (keyOrName) => Effect.map(list, (stores) => findStore(stores, keyOrName)),
    origin,
    addLocal,
    addRemote: remotes.add,
    credential: remotes.credential,
    remove,
    started: () => [...started.keys()],
    stopStarted,
  };
}

/** The store directory: the home store's locations over the desktop's kb, and the paired remote stores. */
export class StoreDirectory extends Context.Service<StoreDirectory, Stores>()(
  "@kb/desktop/StoreDirectory",
) {
  static readonly layer = Layer.effect(
    StoreDirectory,
    Effect.gen(function* () {
      return storeDirectory(
        yield* KbCli,
        yield* DeviceSettings,
        (yield* CaptureClient).pair,
        yield* CredentialKeychain,
      );
    }),
  );
}
