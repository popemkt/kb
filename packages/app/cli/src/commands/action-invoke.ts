/** `kb action-invoke`: any registry action, from raw JSON. */
import type { Command } from "commander";
import { Effect } from "effect";
import { onWire } from "@kb/contracts";
import { writeErr, writeOut } from "@kb/runtime";
import { ACTION_INVOKE_WIRE, EXIT_FAILED, EXIT_OK, invokeCliEffect, kbAction } from "../command.ts";
import { filledLines, formatReceipt } from "../format.ts";
import { readActionJsonEffect } from "../input.ts";
import { mapActionInvoke } from "../map.ts";

export function actionInvokeCommand(program: Command): void {
  program
    .command("action-invoke")
    .description('Raw registry invoke: JSON {"id","input"} or "-" for stdin')
    .argument("<json>", 'JSON object or "-"')
    .action(
      kbAction((ctx, globals, [jsonArg]: [string]) =>
        Effect.gen(function* () {
          const raw = yield* readActionJsonEffect(jsonArg);
          const invocation = onWire(ACTION_INVOKE_WIRE, mapActionInvoke(raw));
          const receipt = yield* invokeCliEffect(ctx, invocation);
          if (globals.json !== true) for (const line of filledLines(receipt)) writeErr(line);
          writeOut(formatReceipt(receipt, { json: globals.json === true }));
          return receipt.status === "succeeded" ? EXIT_OK : EXIT_FAILED;
        }),
      ),
    );
}
