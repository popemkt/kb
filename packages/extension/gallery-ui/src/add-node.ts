/**
 * The gallery's one way to add a node from the page. The id is minted here
 * and given to `node.add`: the page commits a write locally before the
 * server does, and a `node.add` with no id would mint one id on the page
 * and another on the server. An id handed on at once (a look's pins'
 * parent, a pin's visual, a workflow's `from`) must name the node the
 * server keeps.
 */
import { ulid } from "ulid";
import { browserHost, toast, failureText } from "@kb/ui-sdk";

/** What `node.add` takes, less the id this mints. */
export interface NodeAdd {
  readonly text: string;
  /** The node it goes under; null for the top level. */
  readonly parent: string | null;
  readonly tags?: readonly string[];
  readonly props?: readonly unknown[];
}

/** Add the node `input` describes; its id, or null after saying why not, after `failure`. */
export async function addNode(input: NodeAdd, failure: string): Promise<string | null> {
  const id = ulid();
  const receipt = await browserHost().invoke("node.add", { ...input, id });
  if (receipt.status === "failed") {
    toast(`${failure}: ${failureText(receipt)}`);
    return null;
  }
  return id;
}
