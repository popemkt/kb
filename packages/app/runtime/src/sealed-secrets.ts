/**
 * The sealed store: where this host keeps a secret kb writes, encrypted at
 * rest (DESIGN.md → Writable host secrets). A `sealed:<name>` reference is
 * the file `<dir>/<name>.sealed`, whose first line names the cipher that
 * sealed it, so a file always opens with the cipher that made it, and the
 * store seals each new write with the first cipher this host can use:
 *
 * - `systemd-creds`: `systemd-creds encrypt --user`, whose key is the host's
 *   credential secret (readable by root only) and its TPM2 when it has one,
 *   bound to this user. A copied file opens on no other machine.
 * - `aes-256-gcm`: WebCrypto AES-GCM with a random 256-bit key in a private
 *   (0600) file in the same directory. A copy of a sealed file alone, a
 *   backup that leaves the key out or an accidental commit gives nothing
 *   away; anyone who can read this user's files can read the key too.
 *
 * Both bind the secret's name into the seal, so a file renamed to another
 * reference does not open. Failures name the reference, never a value.
 */
import {
  closeSync,
  constants,
  fstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
  chmodSync,
} from "node:fs";
import { join } from "node:path";
import { Effect, Predicate, Result } from "effect";
import {
  acquireFileWriteLockEffect,
  durableCreateFile,
  durableReplaceFile,
  releaseFileWriteLock,
} from "@kb/file-write";
import { SecretError, type SecretSink } from "@kb/contracts";
import { secretRefLabel, type SecretRef } from "@kb/model";
import type { RunLookup } from "./secrets.ts";

type SealedRef = Extract<SecretRef, { kind: "sealed" }>;

/** The first line of every sealed file, before the cipher's id. */
const HEADER = "kb-sealed/1";

/**
 * One way to seal a secret's text and open it again, under the secret's
 * name. `body` is ASCII, so a sealed file is text. A failure says what went
 * wrong in words a person can act on, never with a value.
 */
export interface SealCipher {
  readonly id: string;
  /** Whether this host can seal with it now; asked before each new seal. */
  readonly available: Effect.Effect<boolean>;
  readonly seal: (name: string, value: string) => Effect.Effect<string, SecretError>;
  readonly open: (name: string, body: string) => Effect.Effect<string, SecretError>;
}

/** A sealed store over `dir`, sealing new writes with the first available of `ciphers`. */
export interface SealedSecrets {
  readonly dir: string;
  readonly resolve: (ref: SealedRef) => Effect.Effect<string, SecretError>;
  readonly sink: (ref: SealedRef) => SecretSink;
  /** The cipher a write would seal with now, or null when none is available. */
  readonly cipher: Effect.Effect<string | null>;
}

const labelled = (ref: SealedRef, error: SecretError) =>
  new SecretError({ message: `${secretRefLabel(ref)}: ${error.message}` });

/** A private directory: created 0700, and tightened to it when it exists wider. */
function privateDir(dir: string): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  if ((statSync(dir).mode & 0o077) !== 0) chmodSync(dir, 0o700);
}

/** A private regular file's text; a symlink, or a file others may read, is refused. */
function readPrivate(path: string): string {
  const file = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(file);
    if (!stat.isFile() || (stat.mode & 0o077) !== 0) throw new Error("private file required");
    return readFileSync(file, "utf8");
  } finally {
    closeSync(file);
  }
}

const isMissing = (error: unknown) =>
  Predicate.isObject(error) && "code" in error && error.code === "ENOENT";

export function sealedSecrets(options: {
  readonly dir: () => string;
  readonly ciphers: readonly SealCipher[];
}): SealedSecrets {
  const pathOf = (ref: SealedRef) => join(options.dir(), `${ref.name}.sealed`);
  const chosen = Effect.gen(function* () {
    for (const cipher of options.ciphers) if (yield* cipher.available) return cipher;
    return null;
  });
  return {
    get dir() {
      return options.dir();
    },
    cipher: chosen.pipe(Effect.map((cipher) => cipher?.id ?? null)),
    resolve: Effect.fn("kb.secrets.sealed.read")(function* (ref: SealedRef) {
      const text = yield* Effect.try({
        try: () => readPrivate(pathOf(ref)),
        catch: (error) =>
          new SecretError({
            message: isMissing(error)
              ? `${secretRefLabel(ref)} is not set`
              : `${secretRefLabel(ref)}: the sealed file is not a private regular file`,
          }),
      });
      const newline = text.indexOf("\n");
      const [header, id] = text.slice(0, newline).split(" ");
      const cipher = options.ciphers.find((each) => each.id === id);
      if (newline < 0 || header !== HEADER || cipher === undefined)
        return yield* new SecretError({
          message: `${secretRefLabel(ref)}: sealed by a cipher this host does not have`,
        });
      return yield* cipher
        .open(ref.name, text.slice(newline + 1).trim())
        .pipe(Effect.mapError((error) => labelled(ref, error)));
    }),
    sink: (ref) => ({
      write: Effect.fn("kb.secrets.sealed.write")(function* (value: string) {
        if (value === "" || value.includes("\0"))
          return yield* new SecretError({ message: `${secretRefLabel(ref)}: not a value to keep` });
        const cipher = yield* chosen;
        if (cipher === null)
          return yield* new SecretError({
            message: `${secretRefLabel(ref)}: this host has no cipher to seal with`,
          });
        const path = pathOf(ref);
        const failed = () =>
          new SecretError({ message: `${secretRefLabel(ref)}: the sealed file was not written` });
        yield* Effect.try({ try: () => privateDir(options.dir()), catch: failed });
        yield* Effect.acquireRelease(
          acquireFileWriteLockEffect(path).pipe(Effect.mapError(failed)),
          (lock) => Effect.sync(() => releaseFileWriteLock(lock)),
        );
        const body = yield* cipher
          .seal(ref.name, value)
          .pipe(Effect.mapError((error) => labelled(ref, error)));
        yield* Effect.try({
          try: () =>
            durableReplaceFile({ path, body: `${HEADER} ${cipher.id}\n${body}\n`, mode: 0o600 }),
          catch: failed,
        });
        return undefined;
      }, Effect.scoped),
      erase: Effect.try({
        try: () => rmSync(pathOf(ref), { force: true }),
        catch: () =>
          new SecretError({ message: `${secretRefLabel(ref)}: the sealed file was not removed` }),
      }),
    }),
  };
}

const bytes = (text: string) => new TextEncoder().encode(text);
const aad = (name: string) => bytes(`${HEADER}\0${name}`);
const toBase64 = (data: Uint8Array) => Buffer.from(data).toString("base64");
const fromBase64 = (text: string) => new Uint8Array(Buffer.from(text, "base64"));
const KEY_BYTES = 32;
const NONCE_BYTES = 12;

const unreadableKey = () =>
  new SecretError({ message: "the sealed store's key file cannot be read" });

/** The key file's bytes; a missing file fails with its ENOENT, anything else malformed. */
function readKeyFile(path: string): Uint8Array {
  const key = fromBase64(readPrivate(path).trim());
  if (key.length !== KEY_BYTES) throw new Error("malformed key");
  return key;
}

/**
 * The key at `path`, made on the first seal when there is none. A new key
 * is published whole and only where none is (`durableCreateFile`: written
 * and synced beside it, then linked into place, which never replaces), so
 * of two writers making one at once exactly one key wins and both use it, a
 * reader never sees part of one, and a crash leaves no key rather than a
 * broken one. An existing key, even a malformed one, is never replaced:
 * what it sealed would no longer open.
 */
const keyBytes = Effect.fn("kb.secrets.aes.key")(function* (path: string, create: boolean) {
  const read = Effect.try({
    try: () => readKeyFile(path),
    catch: (error) => (isMissing(error) ? ("missing" as const) : ("unreadable" as const)),
  });
  const first = yield* Effect.result(read);
  if (Result.isSuccess(first)) return first.success;
  if (!create || first.failure !== "missing") return yield* unreadableKey();
  const key = crypto.getRandomValues(new Uint8Array(KEY_BYTES));
  const created = yield* Effect.try({
    try: () => durableCreateFile({ path, body: `${toBase64(key)}\n`, mode: 0o600 }),
    catch: unreadableKey,
  });
  if (created) return key;
  // Another writer's key won: use it.
  return yield* read.pipe(Effect.mapError(unreadableKey));
});

/**
 * AES-256-GCM with a random key kept in `keyPath` (0600, made on the first
 * seal; `keyBytes`). The nonce is random per seal and stored before the
 * ciphertext.
 */
export function aesGcmCipher(keyPath: () => string): SealCipher {
  const importKey = (create: boolean) =>
    keyBytes(keyPath(), create).pipe(
      Effect.flatMap((raw) =>
        Effect.tryPromise({
          try: () =>
            crypto.subtle.importKey("raw", raw.slice(), "AES-GCM", false, ["encrypt", "decrypt"]),
          catch: () => new SecretError({ message: "the sealed store's key is malformed" }),
        }),
      ),
    );
  return {
    id: "aes-256-gcm",
    available: Effect.succeed(true),
    seal: Effect.fn("kb.secrets.aes.seal")(function* (name: string, value: string) {
      const key = yield* importKey(true);
      const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
      const sealed = yield* Effect.tryPromise({
        try: () =>
          crypto.subtle.encrypt(
            { name: "AES-GCM", iv: nonce, additionalData: aad(name) },
            key,
            bytes(value),
          ),
        catch: () => new SecretError({ message: "encryption failed" }),
      });
      const out = new Uint8Array(NONCE_BYTES + sealed.byteLength);
      out.set(nonce);
      out.set(new Uint8Array(sealed), NONCE_BYTES);
      return toBase64(out);
    }),
    open: Effect.fn("kb.secrets.aes.open")(function* (name: string, body: string) {
      const key = yield* importKey(false);
      const data = fromBase64(body);
      const opened = yield* Effect.tryPromise({
        try: () =>
          crypto.subtle.decrypt(
            { name: "AES-GCM", iv: data.slice(0, NONCE_BYTES), additionalData: aad(name) },
            key,
            data.slice(NONCE_BYTES),
          ),
        catch: () =>
          new SecretError({ message: "does not open with this host's key (sealed elsewhere?)" }),
      });
      return new TextDecoder().decode(opened);
    }),
  };
}

/** The command that seals a value (on stdin) under `name`. */
const encrypt = (name: string) => [
  "systemd-creds",
  "encrypt",
  "--user",
  "--tpm2-pcrs=",
  `--name=${name}`,
  "-",
  "-",
];

/**
 * `systemd-creds --user`, sealing to the host's credential key (and its
 * TPM2, with no PCR policy, so a firmware update does not lose the secret).
 * Values pass on stdin and stdout only, never on a command line. Available
 * when a probe seal succeeds, asked once per process.
 */
export function systemdCredsCipher(run: RunLookup, timeoutMs = 30_000): SealCipher {
  let probed: Promise<boolean> | null = null;
  const call = (argv: readonly string[], stdin: string, failure: string) =>
    Effect.tryPromise({
      try: () => run(argv, AbortSignal.timeout(timeoutMs), stdin),
      catch: () => new SecretError({ message: "systemd-creds did not run" }),
    }).pipe(
      Effect.flatMap((result) =>
        result.code === 0 && result.stdout !== ""
          ? Effect.succeed(result.stdout)
          : Effect.fail(new SecretError({ message: failure })),
      ),
    );
  return {
    id: "systemd-creds",
    available: Effect.promise(() => {
      probed ??= run(encrypt("kb-probe"), AbortSignal.timeout(timeoutMs), "probe").then(
        (result) => result.code === 0 && result.stdout.trim() !== "",
        () => false,
      );
      return probed;
    }),
    seal: (name, value) =>
      call(encrypt(name), value, "systemd-creds could not seal it").pipe(
        Effect.map((out) => out.replaceAll(/\s+/g, "")),
      ),
    open: (name, body) =>
      call(
        ["systemd-creds", "decrypt", "--user", `--name=${name}`, "-", "-"],
        body,
        "does not open with this host's credential key (sealed elsewhere, or under another name?)",
      ),
  };
}
