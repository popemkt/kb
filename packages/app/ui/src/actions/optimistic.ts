import type { ActionRequest } from "@kb/contracts";
import type { PlannedMutation } from "@/actions/plan";
import { toast, failureText } from "@kb/ui-sdk";
import { invoke, invokeLocal } from "@/session/runtime";
import { useGraphStore } from "@/stores/graph.store"; // GAP [[01M1RXMRB7AZB7DPFR6XBPBKQ9]]
import { pageEditor } from "@/stores/page-editor"; // GAP [[01M1RXMRB7AZB7DPFR6XBPBKQ9]]

/** The page's editor's state now: where a write lands the caret. */
const editor = () => pageEditor().getState();

export type RunOptimisticResult = {
  ok: boolean;
  focusId?: string;
  focusCursor?: number;
  /**
   * Each write's output, in order, when every one succeeded: a run of node
   * writes is one write (`oneWrite`), answering as one `node.batch`.
   */
  outputs?: unknown[];
};

/** The actions a batch of node writes is made of (DESIGN.md → Batches of writes). */
const BATCH_PARTS: ReadonlySet<string> = new Set(["node.add", "node.update", "node.delete"]);

/**
 * `actions` as the writes they are (DESIGN-UI.md → Outline editor, "A
 * selection is a range of rows"): each run of several node writes is one
 * `node.batch` call, so the commit takes or refuses it whole. An action a
 * batch cannot carry (`tag.define`, say, which a step makes before it tags
 * the rows) is sent as it is, in its place.
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

  const outputs: unknown[] = [];
  for (const action of oneWrite(plan.actions)) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- plans are deliberately ordered (split and merge depend on prior writes)
    const receipt = await (skipRemote ? invokeLocal(action) : invoke(action.id, action.input));
    if (receipt.status === "failed") {
      toast(failureText(receipt));
      return { ok: false };
    }
    outputs.push(receipt.output);
  }

  if (plan.focusId !== undefined) {
    // Its row where the page is being edited: the editor resolves the instance.
    editor().activateNode(plan.focusId, plan.focusCursor ?? 0);
  }
  return { ok: true, focusId: plan.focusId, focusCursor: plan.focusCursor, outputs };
}
