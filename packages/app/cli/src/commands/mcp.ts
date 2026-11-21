/** `kb mcp`: the MCP server on stdio, a host the command loads only when it is the one run. */
import { type Command, CommanderError } from "commander";
import { Effect } from "effect";
import { resolveRootEffect } from "@kb/runtime";
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
    .description("Serve the kb MCP server on stdio")
    .option(
      "--session <mode>",
      "follow: make each call that names no session in the person's most recently active tab",
      toSessionMode,
    )
    .action(
      cliAction((globals, [opts]: [{ session?: "follow" }]) =>
        Effect.gen(function* () {
          const { startMcp } = yield* Effect.promise(() => import("@kb/mcp"));
          const root = yield* resolveRootEffect({ root: globals.root });
          yield* startMcp(root, opts.session === undefined ? {} : { session: opts.session });
          // keep the process alive; the transport owns stdio from here
          return yield* Effect.never;
        }),
      ),
    );
}
