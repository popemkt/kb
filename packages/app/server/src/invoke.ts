import { Effect, Predicate } from "effect";
import type { ActionInvocation, ActionReceipt, KbContext } from "@kb/contracts";
import type { DomainError } from "@kb/model";
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

/** Keys whose string values name nodes, in an input or a refusal's details. */
const ID_KEY = /^(id|ids|parent|target|source|children)$|Id$|Ids$/;

/** The node ids `value` names under an id key, and every other string it holds. */
function strings(value: unknown, key: string, ids: Set<string>, rest: Set<string>): void {
  if (typeof value === "string") (ID_KEY.test(key) ? ids : rest).add(value);
  else if (Array.isArray(value)) for (const item of value) strings(item, key, ids, rest);
  else if (Predicate.isObject(value))
    for (const [k, v] of Object.entries(value)) strings(v, k, ids, rest);
}

/**
 * One refused call, as the server's log says it: the action, the failure
 * code, the tab session that made it, the nodes it named and why it was
 * refused. Never what was written: every other string of the input is cut
 * from the reason, so node text, a name or a query a message echoes stays
 * out of the log.
 */
export function refusalLine(
  invocation: ActionInvocation,
  receipt: Extract<ActionReceipt, { status: "failed" }>,
): string {
  const ids = new Set<string>();
  const rest = new Set<string>();
  strings(invocation.input, "", ids, rest);
  strings(receipt.details, "", ids, new Set());
  let reason = receipt.message;
  // Longest first, so a string inside another is not cut out of it first.
  // Under three characters a string says nothing, and cutting it would.
  for (const text of [...rest].toSorted((a, b) => b.length - a.length)) {
    if (text.length >= 3 && !ids.has(text)) reason = reason.replaceAll(text, "…");
  }
  const session = invocation.session === undefined ? "" : ` session ${invocation.session}`;
  const nodes = ids.size === 0 ? "" : ` nodes ${[...ids].join(",")}`;
  return `kb ui: refused ${receipt.id} (${receipt.code})${session}${nodes}: ${reason}`;
}
