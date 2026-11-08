import type { Command } from "commander";
import { Effect } from "effect";
import { LegacyTrust, onWire } from "@kb/contracts";
import { kbRuntimeLayer, openKbEffect, resolveRootEffect } from "@kb/runtime";
import { ACTION_INVOKE_WIRE, cliAction, invokeCliEffect, report } from "./command.ts";

/** Review root-controlled bytes, then use the ordinary required-approval invocation edge. */
export function trustCommands(program: Command): void {
  program
    .command("trust")
    .description("Manage code trust")
    .command("import")
    .description(
      "Review this machine's legacy digests and ask before importing; the old file stays untouched",
    )
    .argument("[root]", "root holding the old .kb/trust.json; defaults to the current kb")
    .action(
      cliAction((globals, [named]: [string | undefined]) =>
        Effect.gen(function* () {
          const root = yield* resolveRootEffect({ root: named ?? globals.root });
          const ctx = yield* openKbEffect(root);
          return yield* Effect.gen(function* () {
            const digests = yield* (yield* LegacyTrust).digests(root);
            const receipt =
              digests.length === 0
                ? ({
                    status: "succeeded",
                    id: "sandbox.trust.import",
                    output: { imported: [] },
                  } as const)
                : yield* invokeCliEffect(
                    ctx,
                    onWire(ACTION_INVOKE_WIRE, {
                      id: "sandbox.trust.import",
                      input: { root, digests },
                    }),
                  );
            return report(receipt, globals, (output) => [JSON.stringify(output)]);
          }).pipe(Effect.provide(kbRuntimeLayer(ctx)));
        }),
      ),
    );
}
