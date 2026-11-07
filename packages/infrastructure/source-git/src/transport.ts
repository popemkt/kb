import { Effect } from "effect";
import { childProcessEnv } from "@kb/child-process";
import { SOURCE_LIMITS, SourceError } from "@kb/extension-source";

export const GIT_BUDGET = {
  metadataFileBytes: 32 * 1024 * 1024,
  blobFileBytes: SOURCE_LIMITS.bytes + 1024 * 1024,
  stdoutBytes: 16 * 1024 * 1024,
  batchBytes: SOURCE_LIMITS.bytes + SOURCE_LIMITS.files * 128,
  deadlineMs: 60_000,
  refTips: 4096,
} as const;
interface GitOptions {
  readonly input?: Uint8Array;
  readonly outputBytes?: number;
  readonly fileBytes?: number;
}
/** One bounded transport, including git's child helpers. Never exposes stderr credentials. */
export function gitTransport(base: string) {
  return Effect.fn("source.git")(function* (
    args: readonly string[],
    cwd: string,
    options: GitOptions = {},
  ) {
    const blocks = Math.floor((options.fileBytes ?? GIT_BUDGET.metadataFileBytes) / 512);
    return yield* Effect.acquireUseRelease(
      Effect.try({
        try: () =>
          Bun.spawn(
            [
              "sh",
              "-c",
              `ulimit -f ${blocks} && exec "$@"`,
              "kb-git",
              "git",
              "-c",
              "core.hooksPath=/dev/null",
              "-c",
              "protocol.allow=never",
              "-c",
              "protocol.https.allow=always",
              "-c",
              "protocol.ssh.allow=always",
              "-c",
              "fetch.unpackLimit=1",
              "-c",
              "pack.threads=1",
              ...(base.startsWith("file:") ? ["-c", "protocol.file.allow=always"] : []),
              ...args,
            ],
            {
              cwd,
              env: childProcessEnv("git", { GIT_CEILING_DIRECTORIES: cwd }),
              stdin: options.input ?? "ignore",
              stdout: "pipe",
              stderr: "ignore",
            },
          ),
        catch: SourceError.from,
      }),
      (child) =>
        Effect.gen(function* () {
          const reader = child.stdout.getReader();
          const chunks: Uint8Array[] = [];
          let size = 0;
          for (;;) {
            const next = yield* Effect.tryPromise({
              try: () => reader.read(),
              catch: SourceError.from,
            });
            if (next.done) break;
            size += next.value.length;
            if (size > (options.outputBytes ?? GIT_BUDGET.stdoutBytes))
              return yield* new SourceError({
                message: "git output exceeds source transfer budget",
              });
            chunks.push(next.value);
          }
          if ((yield* Effect.promise(() => child.exited)) !== 0)
            return yield* new SourceError({
              message: "git source operation failed within its transfer limits",
            });
          return new Uint8Array(Buffer.concat(chunks));
        }).pipe(
          Effect.timeoutOption(GIT_BUDGET.deadlineMs),
          Effect.flatMap((result) =>
            Effect.fromOption(
              result,
              () => new SourceError({ message: "git source operation timed out" }),
            ),
          ),
        ),
      (child) =>
        Effect.gen(function* () {
          child.kill("SIGKILL");
          yield* Effect.promise(() => child.exited);
        }),
    );
  });
}
export type GitTransport = ReturnType<typeof gitTransport>;
