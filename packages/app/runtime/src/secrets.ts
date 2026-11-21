import { homedir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { SecretError, type SecretSink, type SecretStore } from "@kb/contracts";
import { platformKeychain, runLookup, type KeychainError, type RunLookup } from "@kb/keychain";
import { secretRefLabel, type SecretRef } from "@kb/model";
import { dataPath } from "@kb/workspace-fs";
import { readDotenvSecret, dotenvSecretSink } from "./dotenv-secrets.ts";
import {
  aesGcmCipher,
  sealedSecrets,
  systemdCredsCipher,
  type SealedSecrets,
} from "./sealed-secrets.ts";

/** A keychain failure as a secret error that names the reference. */
function named(ref: SecretRef): (err: KeychainError) => SecretError {
  return (err) => new SecretError({ message: `${secretRefLabel(ref)}: ${err.message}` });
}

/**
 * The secret store a `kb ui` process binds (DESIGN.md → Data model → a
 * secret is a reference, and → Writable host secrets). Reading: an `env:`
 * reference reads this process's environment, a `dotenv:` one reads its
 * private file afresh, a `keychain:` one asks the macOS keychain
 * (`security`) or the freedesktop secret service (`secret-tool`), killed if
 * it has not answered within `timeoutMs`, and a `sealed:` one opens its file
 * in the sealed store under the data directory. Writing: `dotenv:`,
 * `keychain:` and `sealed:` are writable, `env:` is not. A new secret is
 * placed in the macOS keychain on a Mac and in the sealed store elsewhere,
 * since a headless Linux host has no secret service to ask. A reference that
 * does not resolve fails with what it names, never with a value.
 */
export function systemSecrets(
  options: {
    readonly env?: Readonly<Record<string, string | undefined>>;
    readonly platform?: string;
    readonly run?: RunLookup;
    readonly timeoutMs?: number;
    /** The sealed store; by default `<data>/secrets`, resolved on first use. */
    readonly sealed?: SealedSecrets;
  } = {},
): SecretStore {
  // oxlint-disable-next-line node/no-process-env -- the env: reference is this process's environment by definition
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const run = options.run ?? runLookup;
  const keychain = platformKeychain({
    platform,
    run,
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
  });
  const sealed = options.sealed ?? defaultSealed(env, platform, run);
  const place = (name: string): SecretRef =>
    platform === "darwin"
      ? { kind: "keychain", service: "kb", account: name }
      : { kind: "sealed", name };
  return {
    resolve: Effect.fn("kb.secrets.resolve")(function* (ref: SecretRef) {
      const missing = () => new SecretError({ message: `${secretRefLabel(ref)} is not set` });
      if (ref.kind === "env") {
        const value = Object.hasOwn(env, ref.name) ? env[ref.name] : undefined;
        return value === undefined || value === "" ? yield* missing() : value;
      }
      if (ref.kind === "dotenv") return yield* readDotenvSecret(ref);
      if (ref.kind === "sealed") return yield* sealed.resolve(ref);
      const value = yield* keychain.read(ref).pipe(Effect.mapError(named(ref)));
      return value ?? (yield* missing());
    }),
    place,
    sink: (ref: SecretRef): SecretSink => {
      if (ref.kind === "dotenv") return dotenvSecretSink(ref);
      if (ref.kind === "sealed") return sealed.sink(ref);
      if (ref.kind === "env") {
        const readOnly = Effect.fail(
          new SecretError({ message: `${secretRefLabel(ref)}: this source is read-only` }),
        );
        return { write: () => readOnly, erase: readOnly };
      }
      return {
        write: (value: string) => keychain.write(ref, value).pipe(Effect.mapError(named(ref))),
        erase: keychain.erase(ref).pipe(Effect.mapError(named(ref))),
      };
    },
    describe: Effect.gen(function* () {
      if (place("x").kind === "keychain") return "the macOS Keychain";
      const cipher = yield* sealed.cipher;
      if (cipher === "systemd-creds")
        return "encrypted with systemd-creds (this host's credential key and TPM), in kb's data directory";
      if (cipher === "aes-256-gcm")
        return "encrypted with AES-256-GCM in kb's data directory, under a key file beside it";
      return "nowhere: this host has no way to seal a secret";
    }),
  };
}

/** The sealed store under `<data>/secrets`, the data directory resolved when first used. */
function defaultSealed(
  env: Readonly<Record<string, string | undefined>>,
  platform: string,
  run: RunLookup,
): SealedSecrets {
  const dir = () => join(dataPath(env, platform, homedir()), "secrets");
  return sealedSecrets({
    dir,
    ciphers: [
      ...(platform === "linux" ? [systemdCredsCipher(run)] : []),
      aesGcmCipher(() => join(dir(), "key")),
    ],
  });
}
