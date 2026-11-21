import type { ActionReceipt, ActionRequest } from "@kb/contracts";
import type { PlannedMutation } from "@/actions/plan";
import { toast, failureText } from "@kb/ui-sdk";
import { invoke, invokeLocal, invokeSettled } from "@/session/runtime";
import { useGraphStore } from "@/stores/graph.store"; // GAP [[01M1RXMRB7AZB7DPFR6XBPBKQ9]]

export type RunOptimisticResult = {
  ok: boolean;
  focusId?: string;
  focusCursor?: number;
  /** The row instance the plan's focus names, when it names one. */
  focusInstanceKey?: string;
  /**
   * Each write's output, in order, when every one succeeded: a run of node
   * writes is one write (`oneWrite`), answering as one `node.batch`.
   */
  outputs?: unknown[];
  /** The final result for a plan whose caller waits for server acceptance. */
  confirmed?: Promise<boolean>;
};

/** The actions a batch of node writes is made of (DESIGN.md → Batches of writes). */
const BATCH_PARTS: ReadonlySet<string> = new Set([
  "node.add",
  "node.update",
  "node.delete",
  "field.define",
  "tag.define",
]);

/**
 * `actions` as the writes they are (DESIGN-UI.md → Outline editor, "A
 * selection is a range of rows"): each run of several node writes is one
 * `node.batch` call, so the commit takes or refuses it whole. An action a
 * batch cannot carry is sent as it is, in its place.
 */
export function oneWrite(actions: readonly ActionRequest[]): ActionRequest[] {
  const out: ActionRequest[] = [];
  let run: ActionRequest[] = [];
  const flush = (): void => {
    if (run.length > 1) {
      out.push({
        id: "node.batch",
        input: { calls: run.map((action) => ({ action: action.id, input: action.input })) },
      });
    } else out.push(...run);
    run = [];
  };
  for (const action of actions) {
    if (BATCH_PARTS.has(action.id)) {
      run.push(action);
      continue;
    }
    flush();
    out.push(action);
  }
  flush();
  return out;
}

/** Run the canonical actions locally, as one write (`oneWrite`); the browser runtime owns ordered push. */
export async function runOptimistic(
  plan: PlannedMutation,
  opts?: { skipRemote?: boolean },
): Promise<RunOptimisticResult> {
  const skipRemote = opts?.skipRemote === true || useGraphStore.getState().loadSource !== "api";
  const replies: Promise<ActionReceipt>[] = [];
  const write = async (action: ActionRequest): Promise<ActionReceipt> => {
    if (skipRemote) return invokeLocal(action);
    if (plan.completion !== "confirmed") return invoke(action.id, action.input);
    const invoked = await invokeSettled(action);
    replies.push(invoked.settled);
    return invoked.receipt;
  };

  const outputs: unknown[] = [];
  for (const action of oneWrite(plan.actions)) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- plans are deliberately ordered (split and merge depend on prior writes)
    const receipt = await write(action);
    if (receipt.status === "failed") {
      toast(failureText(receipt));
      return { ok: false };
    }
    outputs.push(receipt.output);
  }

  const confirmed =
    replies.length === 0
      ? undefined
      : Promise.all(replies).then((receipts) =>
          receipts.every((receipt) => receipt.status === "succeeded"),
        );
  return {
    ok: true,
    focusId: plan.focusId,
    focusCursor: plan.focusCursor,
    focusInstanceKey: plan.focusInstanceKey,
    outputs,
    confirmed,
  };
}
