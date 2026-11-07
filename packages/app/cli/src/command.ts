/**
 * The CLI's command edges: how a command's Effect becomes Commander's
 * promise and an exit code, how one that needs a session opens it, and the
 * wire every command invokes actions on. Every command module builds on
 * these, so none of them is a copy.
 */
import { openSync } from "node:fs";
import { ReadStream, WriteStream } from "node:tty";
import { createInterface } from "node:readline/promises";
import { type Command, CommanderError } from "commander";
import { Cause, Effect, Option } from "effect";
import type { FileSystem } from "effect/FileSystem";
import type { ActionReceipt, ActionInvocation, KbContext, SurfaceWire } from "@kb/contracts";
import {
  invokeReceiptEffect,
  manifest,
  kbRuntimeLayer,
  openKbEffect,
  processVia,
  type ActionHandlerEnv,
  resolveRootEffect,
  RootNotFoundError,
  writeOut,
  writeErr,
  bunFileSystemLayer,
} from "@kb/runtime";
import { type FailureCode, ResolveError, isDomainError, receiptCodeOf } from "@kb/model";
import { UsageError } from "@kb/operations";
import { EXIT_USAGE } from "./arguments.ts";
import { filledLines, formatReceipt } from "./format.ts";

export const EXIT_OK = 0;
export const EXIT_FAILED = 1;

export interface GlobalOpts {
  json?: boolean;
  root?: string;
}

/**
 * Commander's own `.option()` declarations are the schema for an option bag,
 * and `opts<T>()` is the library's typed accessor for reading one back.
 */
function getGlobals(cmd: Command): GlobalOpts {
  return cmd.optsWithGlobals<GlobalOpts>();
}

/** The one shape of a CLI failure: JSON envelope under --json, else stderr. */
function reportFailure(
  code: FailureCode,
  message: string,
  json: boolean,
  exitCode: number,
): number {
  if (json) {
    writeOut(JSON.stringify({ status: "failed", code, message }));
  } else {
    writeErr(message);
  }
  return exitCode;
}

export function handleCliError(err: unknown, json: boolean): number {
  if (err instanceof UsageError || err instanceof RootNotFoundError) {
    return reportFailure("invalid_input", err.message, json, EXIT_USAGE);
  }
  if (err instanceof ResolveError) {
    // Domain lookup/move failures (unknown field/tag, ambiguous, forbidden,
    // invalid move) surface as typed receipts — never `internal`.
    return reportFailure(receiptCodeOf(err), err.message, json, EXIT_FAILED);
  }
  if (isDomainError(err)) {
    return reportFailure(receiptCodeOf(err), err.message, json, EXIT_FAILED);
  }
  if (err instanceof CommanderError) {
    if (err.code === "commander.helpDisplayed") return EXIT_OK;
    if (err.code === "commander.version") return EXIT_OK;
    writeErr(err.message);
    return EXIT_USAGE;
  }
  return reportFailure(
    "internal",
    err instanceof Error ? err.message : String(err),
    json,
    EXIT_FAILED,
  );
}

/**
 * The CLI's one promise edge. Commander wants an action callback that returns
 * a promise; everything behind it is an Effect, and `process.exitCode` is set
 * here and nowhere else. The `.option()`/`.argument()` declarations on the
 * command are what type `A`.
 */
export function cliAction<A extends readonly unknown[], E>(
  body: (globals: GlobalOpts, args: A) => Effect.Effect<number, E, FileSystem>,
): (this: Command, ...args: A) => Promise<void> {
  return function (this: Command, ...args: A): Promise<void> {
    const globals = getGlobals(this);
    return Effect.runPromise(
      // `suspend` so a plan built eagerly by the body (a bad `--prop`, say)
      // fails inside the Effect rather than throwing out of Commander.
      Effect.suspend(() => body(globals, args)).pipe(
        Effect.provide(bunFileSystemLayer),
        Effect.catchCause((cause) =>
          Effect.succeed(handleCliError(Cause.squash(cause), globals.json === true)),
        ),
        Effect.tap((code) =>
          Effect.sync(() => {
            process.exitCode = code;
          }),
        ),
        Effect.asVoid,
      ),
    );
  };
}

/**
 * A command that needs an open kb session: resolve the root, open the store,
 * and run `body` under {@link kbRuntimeLayer}.
 */
export function kbAction<A extends readonly unknown[], E>(
  body: (
    ctx: KbContext,
    globals: GlobalOpts,
    args: A,
  ) => Effect.Effect<number, E, ActionHandlerEnv>,
): (this: Command, ...args: A) => Promise<void> {
  return cliAction((globals, args) =>
    Effect.gen(function* () {
      const root = yield* resolveRootEffect({ root: globals.root });
      const ctx = yield* openKbEffect(root);
      return yield* body(ctx, globals, args).pipe(Effect.provide(kbRuntimeLayer(ctx)));
    }),
  );
}

/** The JSON envelope cannot approve, so listing on this wire omits asks.
 * The CLI can approve through a controlling-terminal confirmation, owned by invokeCliEffect. */
export const ACTION_INVOKE_WIRE: SurfaceWire = {
  carriesApproval: false,
  actor: "cli",
  ...processVia,
};

/**
 * Print a command's receipt: as is under --json, the failure as the CLI
 * reports every one, and otherwise the `lines` a command reads its output
 * as. The exit code is the receipt's.
 */
export function report(
  receipt: ActionReceipt,
  globals: GlobalOpts,
  lines: (output: unknown) => readonly string[],
): number {
  if (globals.json === true || receipt.status === "failed") {
    writeOut(formatReceipt(receipt, { json: globals.json === true }));
    return receipt.status === "succeeded" ? EXIT_OK : EXIT_FAILED;
  }
  for (const line of filledLines(receipt)) writeErr(line);
  for (const line of lines(receipt.output)) writeOut(line);
  return EXIT_OK;
}

/** Invoke through the CLI; only a terminal confirmation can approve a call. */
export const invokeCliEffect = Effect.fn("invokeCliEffect")(function* (
  ctx: KbContext,
  invocation: ActionInvocation,
) {
  const { approved: _approved, ...call } = invocation;
  const receipt = yield* invokeReceiptEffect(ctx, call);
  if (receipt.status !== "failed" || receipt.code !== "approval_required") return receipt;
  return yield* Effect.acquireUseRelease(
    Effect.sync(() => {
      let input: ReadStream | undefined;
      let output: WriteStream | undefined;
      try {
        input = new ReadStream(openSync("/dev/tty", "r"));
        output = new WriteStream(openSync("/dev/tty", "w"));
        const terminal = createInterface({ input, output });
        return { terminal, input, output };
      } catch {
        input?.destroy();
        output?.destroy();
        return null;
      }
    }),
    (tty) =>
      Effect.gen(function* () {
        if (tty === null) return receipt;
        const title =
          (yield* manifest(ctx.root)).find((entry) => entry.id === call.id)?.title ?? call.id;
        tty.output.write(
          `${call.actor}: ${title} (${call.id}) ${JSON.stringify(call.input)}\n${receipt.message}\n`,
        );
        const answer = yield* Effect.promise(() =>
          tty.terminal.question("Approve this call? [y/N] "),
        ).pipe(Effect.timeoutOption(120_000));
        return Option.isSome(answer) && /^(y|yes)$/i.test(answer.value.trim())
          ? yield* invokeReceiptEffect(ctx, { ...call, approved: true })
          : receipt;
      }),
    (tty) =>
      Effect.sync(() => {
        tty?.terminal.close();
        tty?.input.destroy();
        tty?.output.destroy();
      }),
  );
});
