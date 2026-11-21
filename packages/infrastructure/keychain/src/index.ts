/**
 * The platform keychain, the one place kb reads, writes and erases an item
 * in it: the macOS Keychain through `security`, the freedesktop secret
 * service through `secret-tool`. A value goes to a helper on stdin, never on
 * a command line another user can list. Every ask is killed when it has not
 * answered within its time, since the macOS Keychain may wait for the person
 * to allow it. What an item is for, and how its failure reads, is the
 * caller's: kb's secret store (`@kb/runtime` → `systemSecrets`) and the
 * desktop's remote store credentials both stand on this.
 */
import { Effect, Schema } from "effect";
import { childProcessEnv } from "@kb/child-process";

/** What one helper answered: its exit code and what it printed. */
export interface LookupResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * How a keychain (or sealing) helper is asked: the command line, what it
 * reads on stdin, and what it answered. `signal` aborts when the ask is
 * given up, and the helper stops with it.
 */
export type RunLookup = (
  argv: readonly string[],
  signal: AbortSignal,
  stdin?: string,
) => Promise<LookupResult>;

/** A helper as a child process in a lookup's environment, killed outright when `signal` aborts. */
export const runLookup: RunLookup = (argv, signal, stdin) => {
  const child = Bun.spawn([...argv], {
    stdout: "pipe",
    stderr: "pipe",
    stdin: stdin === undefined ? "ignore" : new TextEncoder().encode(stdin),
    env: childProcessEnv("lookup"),
    signal,
    killSignal: "SIGKILL",
  });
  return Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]).then(([stdout, stderr, code]) => ({ code, stdout, stderr }));
};

/** One keychain item: its service, and its account when it names one. */
export interface KeychainItem {
  readonly service: string;
  readonly account?: string;
}

/** Why a keychain ask failed, in words that name no value (the caller says which item). */
export class KeychainError extends Schema.TaggedError<KeychainError>()("kb/KeychainError", {
  message: Schema.String,
}) {}

function linuxAttributes({ service, account }: KeychainItem): readonly string[] {
  return ["service", service, ...(account === undefined ? [] : ["account", account])];
}

/** The keychain read command for `item` on `platform`, or null where kb knows none. */
function readArgv(item: KeychainItem, platform: string): readonly string[] | null {
  const { service, account } = item;
  if (platform === "darwin")
    return [
      "security",
      "find-generic-password",
      "-s",
      service,
      ...(account === undefined ? [] : ["-a", account]),
      "-w",
    ];
  if (platform === "linux") return ["secret-tool", "lookup", ...linuxAttributes(item)];
  return null;
}

/**
 * How `value` is written to `item` on `platform`: the command, and what it
 * reads on stdin. macOS `security` takes a password only as an argument, so
 * it runs as `security -i` and reads that command on stdin; the value is
 * quoted, and one that cannot be quoted there is refused. The freedesktop
 * `secret-tool store` reads the value on stdin itself.
 */
function writeCommand(
  item: KeychainItem,
  platform: string,
  value: string,
): { readonly argv: readonly string[]; readonly stdin: string } | null {
  const { service, account } = item;
  if (platform === "darwin") {
    if (!/^[^"\\\s]+$/.test(value) || !/^[^"\\\s]+$/.test(service + (account ?? ""))) return null;
    const who = account === undefined ? "" : ` -a "${account}"`;
    return {
      argv: ["security", "-i"],
      stdin: `add-generic-password -U -s "${service}"${who} -w "${value}"\n`,
    };
  }
  if (platform === "linux")
    return {
      argv: ["secret-tool", "store", `--label=kb ${service}`, ...linuxAttributes(item)],
      stdin: value,
    };
  return null;
}

/** How `item` is erased on `platform`, or null where kb knows none. */
function eraseArgv(item: KeychainItem, platform: string): readonly string[] | null {
  const { service, account } = item;
  if (platform === "darwin")
    return [
      "security",
      "delete-generic-password",
      "-s",
      service,
      ...(account === undefined ? [] : ["-a", account]),
    ];
  if (platform === "linux") return ["secret-tool", "clear", ...linuxAttributes(item)];
  return null;
}

/** The platform keychain: read, write and erase an item. */
export interface Keychain {
  /** The item's value, or null when it is not set. */
  readonly read: (item: KeychainItem) => Effect.Effect<string | null, KeychainError>;
  readonly write: (item: KeychainItem, value: string) => Effect.Effect<void, KeychainError>;
  /** Erase the item. An absent item succeeds; a failed deletion is an error. */
  readonly erase: (item: KeychainItem) => Effect.Effect<void, KeychainError>;
}

/** The helper an ask runs, for a message. */
function tool(argv: readonly string[]): string {
  return argv[0] ?? "the keychain";
}

/** How long a keychain ask may take: the macOS Keychain may ask the person first. */
const ASK_TIMEOUT_MS = 30_000;

/** The keychain of `platform` (this one by default), asked through `run`. */
export function platformKeychain(
  options: {
    readonly platform?: string;
    readonly run?: RunLookup;
    readonly timeoutMs?: number;
  } = {},
): Keychain {
  const platform = options.platform ?? process.platform;
  const run = options.run ?? runLookup;
  const timeoutMs = options.timeoutMs ?? ASK_TIMEOUT_MS;
  const ask = (argv: readonly string[], stdin?: string) =>
    Effect.tryPromise({
      try: (signal) => run(argv, signal, stdin),
      catch: () => new KeychainError({ message: `${tool(argv)} did not run` }),
    }).pipe(
      Effect.timeoutOrElse({
        duration: timeoutMs,
        orElse: () =>
          Effect.fail(
            new KeychainError({
              message: `${tool(argv)} did not answer within ${timeoutMs / 1000}s`,
            }),
          ),
      }),
    );
  return {
    read: Effect.fn("kb.keychain.read")(function* (item: KeychainItem) {
      const argv = readArgv(item, platform);
      if (argv === null)
        return yield* new KeychainError({ message: `kb reads no keychain on ${platform}` });
      const answer = yield* ask(argv);
      const value = answer.stdout.replace(/\r?\n$/, "");
      return answer.code !== 0 || value === "" ? null : value;
    }),
    write: Effect.fn("kb.keychain.write")(function* (item: KeychainItem, value: string) {
      const command = writeCommand(item, platform, value);
      if (command === null)
        return yield* new KeychainError({
          message: `kb cannot write this to the keychain on ${platform}`,
        });
      const answer = yield* ask(command.argv, command.stdin);
      if (answer.code !== 0)
        return yield* new KeychainError({ message: `${tool(command.argv)} refused the write` });
      return undefined;
    }),
    erase: Effect.fn("kb.keychain.erase")(function* (item: KeychainItem) {
      const argv = eraseArgv(item, platform);
      if (argv === null)
        return yield* new KeychainError({ message: `kb erases no keychain on ${platform}` });
      const answer = yield* ask(argv);
      if (platform === "linux") {
        // Clear only deletes unlocked matches. Search without --unlock also reports locked matches.
        if (answer.code === 0 || (answer.code === 1 && answer.stderr === "")) {
          const found = yield* ask(["secret-tool", "search", "--all", ...linuxAttributes(item)]);
          if (found.code === 0 && found.stdout === "" && found.stderr === "") return undefined;
        }
      } else if (
        answer.code === 0 ||
        // macOS security reports errSecItemNotFound (-25300) as exit 44.
        // A failed search setup can emit an additional error before the missing-item line.
        (answer.code === 44 &&
          /^security: SecKeychainSearchCopyNext:[^\r\n]+$/.test(answer.stderr.trim()))
      ) {
        return undefined;
      }
      return yield* new KeychainError({ message: `${tool(argv)} refused to delete the item` });
    }),
  };
}
