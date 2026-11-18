/**
 * The kb the desktop runs, and how it runs it: as one-shot commands
 * (`kb locations --json`, `kb open <id> --no-browser --json`), so every
 * store answer comes from the store and its own kb, never from state the app
 * holds (AGENTS.md → Hosts are accelerators). The desktop never imports
 * kb's runtime: the kb it runs is whichever this machine has pinned, and the
 * app and kb update independently.
 */
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { Effect, Option, Schema } from "effect";
import { childProcessEnv } from "@kb/child-process";

/**
 * Where an app started from Finder finds programs. It inherits launchd's
 * bare PATH, not the person's shell's, so the places kb and Bun are
 * installed to (Nix, Homebrew, bun's installer) are added to it.
 */
export function programPath(
  path: string | undefined,
  home: string,
  user: string | undefined,
): string {
  const extra = [
    join(home, ".nix-profile", "bin"),
    ...(user === undefined ? [] : [`/etc/profiles/per-user/${user}/bin`]),
    "/run/current-system/sw/bin",
    "/nix/var/nix/profiles/default/bin",
    "/opt/homebrew/bin",
    "/usr/local/bin",
    join(home, ".bun", "bin"),
    join(home, ".local", "bin"),
  ];
  const have = (path ?? "").split(delimiter).filter((dir) => dir !== "");
  return [...have, ...extra.filter((dir) => !have.includes(dir))].join(delimiter);
}

/** Where to look for kb, in order (the first that exists wins). */
export interface KbCandidates {
  /** The person's setting (`settings.json` → `kb`). */
  readonly setting?: string;
  /** `KB_DESKTOP_KB`, for a run from a terminal. */
  readonly env?: string;
  /** A kb release bundled into the app (`Resources/kb/bin/kb`). */
  readonly bundled?: string;
  /** This checkout's `bin/kb`, when the app runs from one. */
  readonly checkout?: string;
  /** The `PATH` to search for `kb` last. */
  readonly path: string;
}

/** The kb command: the first candidate that exists, else `kb` found on the path. */
export function resolveKb(candidates: KbCandidates): string | null {
  for (const file of [
    candidates.setting,
    candidates.env,
    candidates.bundled,
    candidates.checkout,
  ]) {
    if (file !== undefined && file !== "" && existsSync(file)) return resolve(file);
  }
  for (const dir of candidates.path.split(delimiter)) {
    if (dir !== "" && existsSync(join(dir, "kb"))) return join(dir, "kb");
  }
  return null;
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
  /** `kb --root <root> <args…> --json`, read as a receipt; a kb that cannot run is a failed one. */
  run(root: string, args: readonly string[]): Effect.Effect<Receipt>;
}

/** The receipt a `--json` command printed (one JSON object), or why there is none. */
export function receiptOf(stdout: string, stderr: string, code: number): Receipt {
  return Option.getOrElse(decodeReceipt(stdout), () => {
    const tail = (stderr.trim() || stdout.trim()).slice(-600);
    return {
      status: "failed",
      code: "internal",
      message: `kb exited ${code}: ${tail || "no output"}`,
    } as const;
  });
}

/**
 * The runner over a real kb command, in a kb child's environment
 * (`childProcessEnv("kb")`) on the program path, plus `env`.
 */
export function kbProcessRunner(
  command: string,
  options: { readonly env?: Readonly<Record<string, string>>; readonly timeoutMs?: number } = {},
): KbRunner {
  const timeout = options.timeoutMs ?? 60_000;
  // oxlint-disable-next-line node/no-process-env -- the PATH and user an app child inherits
  const { PATH, USER } = process.env;
  const env = childProcessEnv("kb", { PATH: programPath(PATH, homedir(), USER), ...options.env });
  return {
    run: Effect.fn("kb.desktop.kb.run")(
      function* (root: string, args: readonly string[]) {
        const argv = [command, "--root", root, ...args, "--json"];
        const child = yield* Effect.try({
          try: () =>
            Bun.spawn(argv, { env, stdin: "ignore", stdout: "pipe", stderr: "pipe", timeout }),
          catch: (err) => String(err),
        });
        const [stdout, stderr, code] = yield* Effect.promise(() =>
          Promise.all([
            new Response(child.stdout).text(),
            new Response(child.stderr).text(),
            child.exited,
          ]),
        );
        return receiptOf(stdout, stderr, code);
      },
      Effect.catch((why: string) =>
        Effect.succeed<Receipt>({
          status: "failed",
          code: "internal",
          message: `kb could not run: ${why}`,
        }),
      ),
    ),
  };
}
