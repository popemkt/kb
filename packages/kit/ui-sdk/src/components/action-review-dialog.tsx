/** One modal lifetime for an invocation's existing action review. */
import type { ActionInvocation } from "@kb/contracts";
import { ActionApproval } from "./action-approval";
import { Dialog } from "./dialog";

export function ActionReviewDialog({
  invocation,
  answer,
  close,
}: {
  readonly invocation: ActionInvocation;
  readonly answer: (approved: boolean) => void | Promise<void>;
  readonly close: () => void;
}) {
  return (
    // GAP [[01M7HY51KS03P1CFM90JH4CS8Z]]: the review draws its answer buttons in its body, not the dialog's actions.
    <Dialog title="Review & trust" onClose={close} className="sm:max-w-3xl">
      <ActionApproval invocation={invocation} answer={answer} />
    </Dialog>
  );
}
