import { Effect, Predicate } from "effect";
import type { ActionInvocation, ActionReceipt, KbContext } from "@kb/contracts";
import { isNodeIdShaped, type DomainError } from "@kb/model";
import { reloadEffect } from "@kb/operations";
import { type ActionHandlerEnv, invokeReceiptEffect, writeErr } from "@kb/runtime";

/**
 * How the `kb ui` server runs an invocation it is handed: over the session
 * brought up to date first, so a write another process made is not missed,
 * then through the invoke core. What the invocation commits reaches watchers
 * through the log, which the hub is already subscribed to: persist → log →
 * hub, with no second path from here and nothing to wait for fs.watch to
 * notice. A store that cannot be reloaded fails here; the caller says what
 * that means on its wire.
 *
 * Every call it refuses is written to the server's log as one line
 * ({@link refusalLine}), so a refusal a page only showed as a toast can be
 * found again afterwards.
 */
export const serverInvoke = Effect.fn("kb.ui.invoke")(function* (
  ctx: KbContext,
  invocation: ActionInvocation,
): Effect.fn.Return<ActionReceipt, DomainError, ActionHandlerEnv> {
  yield* reloadEffect(ctx);
  const receipt = yield* invokeReceiptEffect(ctx, invocation);
  if (receipt.status === "failed")
    yield* Effect.sync(() => writeErr(refusalLine(invocation, receipt)));
  return receipt;
});

/**
 * Every string in `value`, at any depth, shaped like a node id. By shape,
 * not by key: what sits under a key named `id` in free-form settings may be
 * anything, and a node's id is a ULID or a `sys.` id wherever it sits.
 */
function nodeIds(value: unknown, ids: Set<string>): void {
  if (typeof value === "string") {
    if (isNodeIdShaped(value)) ids.add(value);
  } else if (Array.isArray(value)) for (const item of value) nodeIds(item, ids);
  else if (Predicate.isObject(value)) for (const item of Object.values(value)) nodeIds(item, ids);
}

/**
 * One refused call, as the server's log says it: the action, the failure
 * code, the tab session that made it and the nodes it named — what the
 * receipt says by its structure. Never its message: that is free text an
 * action writes, and it may quote what was written or what the graph holds
 * (a node's text, a name, a query). The page that made the call shows it.
 */
export function refusalLine(
  invocation: ActionInvocation,
  receipt: Extract<ActionReceipt, { status: "failed" }>,
): string {
  const ids = new Set<string>();
  nodeIds(invocation.input, ids);
  nodeIds(receipt.details, ids);
  const session = invocation.session === undefined ? "" : ` session ${invocation.session}`;
  const nodes = ids.size === 0 ? "" : ` nodes ${[...ids].join(",")}`;
  return `kb ui: refused ${receipt.id} (${receipt.code})${session}${nodes}`;
}
