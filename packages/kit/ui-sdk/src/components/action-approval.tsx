/** One default action review and its decision controls, independent of the asking surface. */
import type { ActionInvocation } from "@kb/contracts";
import { cn } from "../lib/cn";

const BUTTON = cn(
  "rounded-sm px-2 py-1 text-label font-medium outline-none transition duration-100",
  "focus-visible:ring-2 focus-visible:ring-primary/60 disabled:cursor-default disabled:opacity-40",
);

interface ActionApprovalProps {
  readonly invocation: ActionInvocation;
  readonly answer: (approved: boolean) => void;
}

function ApprovalDecision({ answer }: Pick<ActionApprovalProps, "answer">) {
  return (
    <div className="mt-2 flex justify-end gap-1">
      <button
        type="button"
        className={cn(BUTTON, "text-foreground/60 hover:bg-foreground/[0.06]")}
        onClick={() => answer(false)}
      >
        Decline
      </button>
      <button
        type="button"
        className={cn(BUTTON, "bg-primary text-primary-foreground hover:bg-primary/90")}
        onClick={() => answer(true)}
      >
        Approve once
      </button>
    </div>
  );
}

export function DefaultActionApproval({ invocation, answer }: ActionApprovalProps) {
  return (
    <>
      <pre className="mt-2 max-h-32 overflow-auto rounded-sm bg-background p-2 font-mono text-label text-foreground/70">
        {JSON.stringify(invocation.input, null, 2)}
      </pre>
      <ApprovalDecision answer={answer} />
    </>
  );
}
