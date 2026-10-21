import { Cause, Effect } from "effect";
import {
  onWire,
  type ActionInvocation,
  type ActionReceipt,
  type ActionRequest,
  type KbContext,
  type SurfaceWire,
} from "@kb/contracts";
import { kbRuntimeLayer } from "./layers.ts";
import { invokeReceiptEffect, receiptFromError } from "./registry.ts";

/**
 * The wire of kb's own code calling in this process, through {@link invoke}:
 * the owner's, as the command line is, since it runs with what the owner
 * runs it with. It relays: a call already made on another wire in this
 * process (an agent's, a script's) keeps who made it, since only code
 * already running here, with its whole reach, hands one over.
 */
export const IN_PROCESS_WIRE: SurfaceWire = { carriesApproval: true, actor: "cli", relays: true };

/**
 * Invoke an action in this process: a call made on another wire as that
 * wire made it, a bare request as {@link IN_PROCESS_WIRE} makes it. Never throws across this boundary — failures become
 * receipts. Thin Promise compatibility edge over `invokeReceiptEffect` plus
 * the live Layers; it lives beside the registry rather than inside it so the
 * runtime layer can read the registry's templates without an import cycle.
 */
export function invoke(
  ctx: KbContext,
  request: ActionRequest | ActionInvocation,
): Promise<ActionReceipt> {
  return Effect.runPromise(
    invokeReceiptEffect(ctx, onWire(IN_PROCESS_WIRE, request)).pipe(
      Effect.provide(kbRuntimeLayer(ctx)),
      Effect.catchCause((cause) =>
        Effect.succeed(receiptFromError(request.id, Cause.squash(cause))),
      ),
    ),
  );
}
