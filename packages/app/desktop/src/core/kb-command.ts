/**
 * The kb the desktop runs, and how it runs it: as one-shot commands
 * (`kb locations --json`, `kb open <id> --no-browser --json`), so every
 * store answer comes from the store and its own kb, never from state the app
 * holds (AGENTS.md → Hosts are accelerators). The desktop never imports
 * kb's runtime: the kb it runs is whichever this machine has pinned, and the
 * app and kb update independently.
 */
import { existsSync, realpathSync } from "node:fs";
import { delimiter, dirname, join, resolve } from "node:path";
import { Effect, Option, Schema } from "effect";
import { childProcessEnv } from "@kb/child-process";

/** What the program path is made from: the inherited PATH, whose home it is, and the runtimes kb may need. */
export interface ProgramPlaces {
  /** The PATH the app inherited (launchd's bare one when opened from Finder). */
  readonly path: string | undefined;
  readonly home: string;
  readonly user: string | undefined;
  /**
   * Runtimes a kb script execs by name, by absolute path: the Bun the app
   * was built with, which may live only in a Nix store or a dev shell, where
   * no PATH an app opened from Finder has would find it.
   */
  readonly runtimes?: readonly string[];
}

/**
 * Where an app started from Finder finds programs. It inherits launchd's
 * bare PATH, not the person's shell's, so the places kb and Bun are
 * installed to (Nix, Homebrew, bun's installer) are added to it, and the
 * directories of `runtimes` after them: an installed Bun wins, and the
 * build's Bun is there when none is installed.
 */
export function programPath({ path, home, user, runtimes = [] }: ProgramPlaces): string {
  const extra = [
    join(home, ".nix-profile", "bin"),
    ...(user === undefined ? [] : [`/etc/profiles/per-user/${user}/bin`]),
    "/run/current-system/sw/bin",
    "/nix/var/nix/profiles/default/bin",
    "/opt/homebrew/bin",
    "/usr/local/bin",
    join(home, ".bun", "bin"),
    join(home, ".local", "bin"),
    ...runtimes.map((runtime) => dirname(runtime)),
  ];
  const dirs = [...(path ?? "").split(delimiter), ...extra].filter((dir) => dir !== "");
  return [...new Set(dirs)].join(delimiter);
}

/**
 * The environment of every kb the desktop runs, the one place it is made:
 * a kb child's (`childProcessEnv("kb")`) on the program path, plus
 * `overrides`. The probe, the search for kb on the path and the commands
 * all read this one environment, so a kb that answered the probe runs the
 * commands the same way.
 */
export function kbEnvironment(
  places: ProgramPlaces,
  overrides: Readonly<Record<string, string>> = {},
): Record<string, string> {
  return childProcessEnv("kb", { PATH: programPath(places), ...overrides });
}

/** Where a kb candidate came from. */
type KbSource = "setting" | "env" | "bundled" | "checkout" | "path";

const SOURCE_LABEL: Readonly<Record<KbSource, string>> = {
  setting: '"kb" in settings.json',
  env: "KB_DESKTOP_KB",
  bundled: "the kb bundled in the app",
  checkout: "the checkout the app was built from",
  path: "kb on the PATH",
};

/** A kb the desktop may run: its file, and where it came from. */
export interface KbCandidate {
  readonly source: KbSource;
  readonly file: string;
}

/** A candidate in words: `/path/to/kb (kb on the PATH)`. */
export function describeKb(kb: KbCandidate): string {
  return `${kb.file} (${SOURCE_LABEL[kb.source]})`;
}

/**
 * What to do when the desktop's kb cannot run, said once: name a kb that
 * runs in the settings. The app resolves its kb at launch, so it applies
 * after a reopen.
 */
export function kbAdvice(settingsFile: string): string {
  return `Set "kb" in ${settingsFile} to the full path of a kb that runs (in a terminal, \`command -v kb\` prints one), then quit and reopen kb.`;
}

/** The places a kb may be, as the composition root finds them. */
export interface KbPlaces {
  /** The person's setting (`settings.json` → `kb`). */
  readonly setting?: string;
  /** `KB_DESKTOP_KB`, for a run from a terminal. */
  readonly env?: string;
  /** A kb release bundled into the app (`Resources/app/kb/bin/kb`). */
  readonly bundled?: string;
  /** The `bin/kb` of the checkout the app was built from. */
  readonly checkout?: string;
  /** The program path (`programPath`), searched for `kb`. */
  readonly path: string;
}

/**
 * How the build is used, which decides whether the checkout's kb or an
 * installed one comes first: a `dev` build is run while kb itself is being
 * changed, so its checkout's kb leads; any other build (`stable`, `canary`,
 * or a channel the app cannot read) is used day to day and runs the kb the
 * person installed.
 */
export type KbChannel = "dev" | "release";

/** The kb channel of an Electrobun build channel (`version.json` → `channel`). */
export function kbChannel(buildChannel: string): KbChannel {
  return buildChannel === "dev" ? "dev" : "release";
}

/** A kb the person named: a candidate whether or not its file is there. */
function named(source: KbSource, file: string | undefined): KbCandidate[] {
  return file === undefined || file === "" ? [] : [{ source, file: resolve(file) }];
}

/** A place the app looks on its own: a candidate only when a kb is there. */
function found(source: KbSource, file: string | undefined): KbCandidate[] {
  return named(source, file).filter((kb) => existsSync(kb.file));
}

/**
 * The kbs to try, in order (README → Which kb it runs). A kb the person
 * named (the setting, `KB_DESKTOP_KB`) is tried even when its file is
 * missing, so that it is reported rather than passed over in silence; a
 * place the app looks on its own is tried only when a kb is there.
 */
export function kbCandidates(places: KbPlaces, channel: KbChannel): KbCandidate[] {
  const seen = new Set<string>();
  const onPath = places.path.split(delimiter).flatMap((dir): KbCandidate[] => {
    const file = join(dir, "kb");
    if (dir === "" || !existsSync(file)) return [];
    const real = realpathSync(file);
    if (seen.has(real)) return [];
    seen.add(real);
    return [{ source: "path", file }];
  });
  const checkout = found("checkout", places.checkout);
  return [
    ...named("setting", places.setting),
    ...named("env", places.env),
    ...found("bundled", places.bundled),
    ...(channel === "dev" ? [...checkout, ...onPath] : [...onPath, ...checkout]),
  ];
}

/** Whether a kb runs: null when it does, else why it does not. A port, so resolution is tested without processes. */
export type KbProbe = (kb: KbCandidate) => Effect.Effect<string | null>;

/** A candidate that could not run, and why. */
interface SkippedKb {
  readonly kb: KbCandidate;
  readonly why: string;
}

/** The kb the desktop runs, and the candidates before it that could not run. */
export interface KbInUse {
  readonly kb: KbCandidate;
  readonly skipped: readonly SkippedKb[];
}

/** What resolution found: a kb in use, or none, with why each candidate could not run. */
type KbChoice = KbInUse | { readonly kb: null; readonly skipped: readonly SkippedKb[] };

/** The first candidate that runs, keeping (and logging) why each one before it did not. */
export const resolveKb = Effect.fn("kb.desktop.kb.resolve")(function* (
  candidates: readonly KbCandidate[],
  probe: KbProbe,
) {
  const skipped: SkippedKb[] = [];
  for (const kb of candidates) {
    const why = yield* probe(kb);
    if (why === null) {
      const inUse: KbChoice = { kb, skipped };
      return inUse;
    }
    yield* Effect.logWarning(`kb desktop passed over ${describeKb(kb)}: ${why}`);
    skipped.push({ kb, why });
  }
  const none: KbChoice = { kb: null, skipped };
  return none;
});

/** What a finished child printed, and how it ended. */
interface Finished {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number;
  readonly timedOut: boolean;
}

/** Run `argv` in `env` to its end (killed after `timeout` ms); a child that cannot start fails with why. */
const runToEnd = Effect.fn("kb.desktop.kb.spawn")(function* (
  argv: readonly string[],
  env: Readonly<Record<string, string>>,
  timeout: number,
) {
  const child = yield* Effect.try({
    try: () =>
      Bun.spawn([...argv], { env, stdin: "ignore", stdout: "pipe", stderr: "pipe", timeout }),
    catch: (err) => String(err),
  });
  const [stdout, stderr, code] = yield* Effect.promise(() =>
    Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]),
  );
  return { stdout, stderr, code, timedOut: child.signalCode !== null } satisfies Finished;
});

/** The last of what a child said, for a message. */
function tailOf(finished: Finished): string {
  return (finished.stderr.trim() || finished.stdout.trim()).slice(-600) || "no output";
}

/**
 * The probe over real processes: a kb runs when `kb --version` answers in
 * `env` within `timeoutMs`. That is the step an app opened from Finder
 * fails at (a launcher that cannot find its runtime); kb answers it before
 * it loads its runtime, so it costs a fraction of a second.
 */
// GAP [[01M7WV5DBWNMEWS2QG6M4VP3QY]]: proves the kb runs, not that it serves the capture contract.
export function processProbe(env: Readonly<Record<string, string>>, timeoutMs = 5_000): KbProbe {
  return (kb) =>
    existsSync(kb.file)
      ? runToEnd([kb.file, "--version"], env, timeoutMs).pipe(
          Effect.map((finished) => {
            if (finished.timedOut) return `\`kb --version\` did not answer within ${timeoutMs} ms`;
            if (finished.code === 0 && finished.stdout.trim() !== "") return null;
            return `\`kb --version\` exited ${finished.code}: ${tailOf(finished)}`;
          }),
          Effect.catch((why: string) => Effect.succeed(`it could not start: ${why}`)),
        )
      : Effect.succeed(`there is no file at ${kb.file}`);
}

/** A receipt as `--json` prints it. */
const ReceiptSchema = Schema.Union([
  Schema.Struct({ status: Schema.Literal("succeeded"), output: Schema.Unknown }),
  Schema.Struct({ status: Schema.Literal("failed"), code: Schema.String, message: Schema.String }),
]);
export type Receipt = typeof ReceiptSchema.Type;
const decodeReceipt = Schema.decodeUnknownOption(Schema.fromJsonString(ReceiptSchema));

/** Runs one-shot kb commands. A port, so the core is tested without a kb. */
export interface KbRunner {
  /** Which kb runs the commands, so the store list can say so. */
  readonly inUse: KbInUse;
  /** `kb --root <root> <args…> --json`, read as a receipt; a kb that cannot run is a failed one. */
  run(root: string, args: readonly string[]): Effect.Effect<Receipt>;
}

/**
 * The receipt a `--json` command printed (one JSON object), or why there is
 * none, followed by `context`: which kb ran and what to do about it.
 */
function receiptOf(stdout: string, stderr: string, code: number, context: string): Receipt {
  return Option.getOrElse(decodeReceipt(stdout), () => ({
    status: "failed",
    code: "internal",
    message: `kb exited ${code}: ${tailOf({ stdout, stderr, code, timedOut: false })}. ${context}`,
  }));
}

/**
 * The runner over a real kb, in `env` (`kbEnvironment`). A kb that does not
 * answer with a receipt is a failure that names the kb that ran and says
 * what to do (`kbAdvice` over `settingsFile`).
 */
export function kbProcessRunner(
  inUse: KbInUse,
  options: {
    readonly env: Readonly<Record<string, string>>;
    readonly settingsFile: string;
    readonly timeoutMs?: number;
  },
): KbRunner {
  const timeout = options.timeoutMs ?? 60_000;
  const context = `It ran ${describeKb(inUse.kb)}. ${kbAdvice(options.settingsFile)}`;
  return {
    inUse,
    run: Effect.fn("kb.desktop.kb.run")(
      function* (root: string, args: readonly string[]) {
        const finished = yield* runToEnd(
          [inUse.kb.file, "--root", root, ...args, "--json"],
          options.env,
          timeout,
        );
        return receiptOf(finished.stdout, finished.stderr, finished.code, context);
      },
      Effect.catch((why: string) =>
        Effect.succeed<Receipt>({
          status: "failed",
          code: "internal",
          message: `kb could not run: ${why}. ${context}`,
        }),
      ),
    ),
  };
}
