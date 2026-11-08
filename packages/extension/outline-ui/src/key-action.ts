/**
 * A key that runs an action (`KeyRun.action`): the one step both of the
 * outline's keymaps take for it. The action is about the row the key was
 * pressed on, so the row's node is its input's `id`, and it runs through
 * the page's one invoke path, under the guards every call meets.
 */
import { browserHost, toast, type KeyRun } from "@kb/ui-sdk";

/** The step a key that runs an action means: which action, with what input. */
export interface RunAction {
  readonly type: "runAction";
  readonly action: string;
  readonly input: Readonly<Record<string, unknown>>;
}

/** What `run` means on the row of `nodeId`: its action, or null for a run that names an intent. */
export function runActionOf(run: KeyRun, nodeId: string): RunAction | null {
  if (!("action" in run)) return null;
  return { type: "runAction", action: run.action, input: { ...run.input, id: nodeId } };
}

/** Invoke it, telling the person when the call fails. */
export function invokeKeyAction({ action, input }: RunAction): void {
  void browserHost()
    .invoke(action, input)
    .then((receipt) => {
      if (receipt.status === "failed") toast(`${action} failed: ${receipt.message}`);
    });
}
