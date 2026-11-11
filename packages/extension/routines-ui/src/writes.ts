/**
 * The calendar's one way to write: a gesture's node calls, made in order
 * through the page's invoke path, which commits each locally before the
 * server does. Ids are minted here and handed to `node.add`, so the page and
 * the server name the same node. A call that fails says why and stops the
 * rest.
 */
import { ulid } from "ulid";
import type { NodeCall } from "@kb/routines";
import { browserHost, toast, failureText } from "@kb/ui-sdk";

/** A new node id. */
export const mintId = (): string => ulid();

/** Make `calls` in order; whether every one was made, after saying why not, after `failure`. */
export async function runCalls(calls: readonly NodeCall[], failure: string): Promise<boolean> {
  const [call, ...rest] = calls;
  if (call === undefined) return true;
  const receipt = await browserHost().invoke(call.id, call.input);
  if (receipt.status === "failed") {
    toast(`${failure}: ${failureText(receipt)}`);
    return false;
  }
  return runCalls(rest, failure);
}

/** Ask the engine to push every pending and failed routine now. */
export async function syncNow(): Promise<void> {
  const receipt = await browserHost().invoke("ext.routines.sync", {});
  toast(
    receipt.status === "succeeded" ? "Sync requested" : `Sync now failed: ${failureText(receipt)}`,
  );
}
