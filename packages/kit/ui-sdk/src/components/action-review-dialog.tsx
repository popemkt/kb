/** One modal lifetime for an invocation's existing action review. */
import { useEffect, useId, useRef } from "react";
import type { ActionInvocation } from "@kb/contracts";
import { ActionApproval } from "./action-approval";

export function ActionReviewDialog({
  invocation,
  answer,
  close,
}: {
  readonly invocation: ActionInvocation;
  readonly answer: (approved: boolean) => void | Promise<void>;
  readonly close: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useId();
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      aria-labelledby={title}
      onCancel={close}
      className="m-auto max-h-[85vh] w-full max-w-3xl overflow-auto rounded-md border border-border bg-card p-5 text-foreground"
    >
      <h3 id={title} className="text-title">
        Review &amp; trust
      </h3>
      <ActionApproval invocation={invocation} answer={answer} />
    </dialog>
  );
}
