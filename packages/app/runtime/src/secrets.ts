import { homedir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { SecretError, type SecretSink, type SecretStore } from "@kb/contracts";
import { secretRefLabel, type SecretRef } from "@kb/model";
import { dataPath } from "@kb/workspace-fs";
import { readDotenvSecret, dotenvSecretSink } from "./dotenv-secrets.ts";
import {
  aesGcmCipher,
  sealedSecrets,
  systemdCredsCipher,
  type SealedSecrets,
} from "./sealed-secrets.ts";
import { childProcessEnv } from "./child-env.ts";

/** What one keychain lookup answered: its exit code and what it printed. */
export interface LookupResult {
  readonly code: number;
  readonly stdout: string;
}

/**
 * How the platform keychain (or a sealing helper) is asked: the command
 * line, what it reads on stdin, and what it answered. A value kb hands a
 * helper goes on stdin, never on a command line another user can list.
 * `signal` aborts when the lookup is given up, and the lookup stops with it.
 */
export type RunLookup = (
  argv: readonly string[],
  signal: AbortSignal,
  stdin?: string,
) => Promise<LookupResult>;

/**
 * How long a keychain lookup may take. The macOS keychain may ask the person
 * to allow the read, so this leaves time to answer; past it the lookup is
 * killed and the reference fails, so a turn never hangs on it.
 */
const LOOKUP_TIMEOUT_MS = 30_000;

/** The keychain command for `ref` on `platform`, or null where kb knows none. */
function keychainArgv(
  ref: Extract<SecretRef, { kind: "keychain" }>,
  platform: string,
): readonly string[] | null {
  const account = ref.account;
  if (platform === "darwin") {
    return [
      "security",
      "find-generic-password",
      "-s",
      ref.service,
      ...(account === undefined ? [] : ["-a", account]),
      "-w",
    ];
  }
  if (platform === "linux") {
    return [
      "secret-tool",
      "lookup",
      "service",
      ref.service,
      ...(account === undefined ? [] : ["account", account]),
    ];
  }
  return null;
}

/**
 * How `ref` is written to the keychain on `platform`: the command, and what
 * it reads on stdin. macOS `security` takes a password only as an argument,
 * so it runs as `security -i` and reads that command on stdin; the value is
 * quoted, and one that cannot be quoted there is refused. The freedesktop
 * `secret-tool store` reads the value on stdin itself.
 */
function keychainWrite(
  ref: Extract<SecretRef, { kind: "keychain" }>,
  platform: string,
  value: string,
): { readonly argv: readonly string[]; readonly stdin: string } | null {
  const account = ref.account;
  if (platform === "darwin") {
    if (!/^[^"\\\s]+$/.test(value) || !/^[^"\\\s]+$/.test(ref.service + (account ?? "")))
      return null;
    const who = account === undefined ? "" : ` -a "${account}"`;
    return {
      argv: ["security", "-i"],
      stdin: `add-generic-password -U -s "${ref.service}"${who} -w "${value}"\n`,
    };
  }
  if (platform === "linux") {
    return {
      argv: [
        "secret-tool",
        "store",
        `--label=kb ${ref.service}`,
        "service",
        ref.service,
        ...(account === undefined ? [] : ["account", account]),
      ],
      stdin: value,
    };
  }
  return null;
}

/** How `ref` is deleted from the keychain on `platform`, or null where kb knows none. */
function keychainErase(
  ref: Extract<SecretRef, { kind: "keychain" }>,
  platform: string,
): readonly string[] | null {
  const account = ref.account;
  if (platform === "darwin")
    return [
      "security",
      "delete-generic-password",
      "-s",
      ref.service,
      ...(account === undefined ? [] : ["-a", account]),
    ];
  if (platform === "linux")
    return [
      "secret-tool",
      "clear",
      "service",
      ref.service,
      ...(account === undefined ? [] : ["account", account]),
    ];
  return null;
}

/** A lookup as a child process, killed outright when `signal` aborts. */
const runProcess: RunLookup = (argv, signal, stdin) => {
  const child = Bun.spawn([...argv], {
    stdout: "pipe",
    stderr: "ignore",
    stdin: stdin === undefined ? "ignore" : new TextEncoder().encode(stdin),
    env: childProcessEnv("lookup"),
    signal,
    killSignal: "SIGKILL",
  });
  return Promise.all([new Response(child.stdout).text(), child.exited]).then(([stdout, code]) => ({
    code,
    stdout,
  }));
};

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
  const run = options.run ?? runProcess;
  const timeoutMs = options.timeoutMs ?? LOOKUP_TIMEOUT_MS;
  const sealed = options.sealed ?? defaultSealed(env, platform, run);
  const ask = (ref: SecretRef, argv: readonly string[], stdin?: string) =>
    Effect.tryPromise({
      try: (signal) => run(argv, signal, stdin),
      catch: () =>
        new SecretError({
          message: `${secretRefLabel(ref)}: ${argv[0] ?? "the keychain"} did not run`,
        }),
    }).pipe(
      Effect.timeoutOrElse({
        duration: timeoutMs,
        orElse: () =>
          Effect.fail(
            new SecretError({
              message: `${secretRefLabel(ref)}: ${argv[0] ?? "the keychain"} did not answer within ${timeoutMs / 1000}s`,
            }),
          ),
      }),
    );
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
      const argv = keychainArgv(ref, platform);
      if (argv === null) {
        return yield* new SecretError({
          message: `${secretRefLabel(ref)}: kb reads no keychain on ${platform}`,
        });
      }
      const answer = yield* ask(ref, argv);
      const value = answer.stdout.replace(/\r?\n$/, "");
      return answer.code !== 0 || value === "" ? yield* missing() : value;
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
        write: Effect.fn("kb.secrets.keychain.write")(function* (value: string) {
          const write = keychainWrite(ref, platform, value);
          if (write === null)
            return yield* new SecretError({
              message: `${secretRefLabel(ref)}: kb cannot write this to the keychain on ${platform}`,
            });
          const answer = yield* ask(ref, write.argv, write.stdin);
          if (answer.code !== 0)
            return yield* new SecretError({
              message: `${secretRefLabel(ref)}: ${write.argv[0] ?? "the keychain"} refused the write`,
            });
          return undefined;
        }),
        erase: Effect.gen(function* () {
          const argv = keychainErase(ref, platform);
          if (argv === null)
            return yield* new SecretError({
              message: `${secretRefLabel(ref)}: kb writes no keychain on ${platform}`,
            });
          // An item already gone is erased: neither command tells that apart from success here.
          yield* ask(ref, argv);
          return undefined;
        }),
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
