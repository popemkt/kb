/**
 * `kb mcp`: the MCP server on stdio, or over Streamable HTTP with `--listen`,
 * a host the command loads only when it is the one run.
 */
import { type Command, CommanderError } from "commander";
import { Effect } from "effect";
import { resolveRootEffect, writeErr } from "@kb/runtime";
import { EXIT_USAGE } from "../arguments.ts";
import { cliAction } from "../command.ts";

/** `kb mcp --session`: the one mode there is, following the person's most recently active tab. */
export const toSessionMode = (value: string): "follow" => {
  if (value === "follow") return value;
  throw new CommanderError(
    EXIT_USAGE,
    "commander.invalidArgument",
    `--session takes follow (each call in the person's most recently active tab), not ${value}`,
  );
};

export function mcpCommand(program: Command): void {
  program
    .command("mcp")
    .description("Serve the kb MCP server on stdio, or over Streamable HTTP with --listen")
    .option(
      "--session <mode>",
      "follow: make each call that names no session in the person's most recently active tab",
      toSessionMode,
    )
    .option(
      "--listen <address>",
      "serve over Streamable HTTP at /mcp instead of stdio: unix:<path> (mode 0600), 127.0.0.1:<port> or [::1]:<port>; no authentication",
    )
    .action(
      cliAction((globals, [opts]: [{ session?: "follow"; listen?: string }]) =>
        Effect.gen(function* () {
          const { listenMcp, mcpAddressOf, startMcp } = yield* Effect.promise(
            () => import("@kb/mcp"),
          );
          const root = yield* resolveRootEffect({ root: globals.root });
          const options = opts.session === undefined ? {} : { session: opts.session };
          if (opts.listen === undefined) {
            yield* startMcp(root, options);
          } else {
            const { at } = yield* listenMcp(root, opts.listen, options);
            writeErr(`kb mcp listening on ${mcpAddressOf(at)}`);
          }
          // keep the process alive; the transport owns stdio, or the listener the process
          return yield* Effect.never;
        }),
      ),
    );
}
