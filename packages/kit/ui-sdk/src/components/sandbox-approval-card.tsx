/**
 * A call a sandboxed run made that needs a person's approval (DESIGN.md →
 * Sandbox → Grants and the script actor): the action and its input, and
 * the person's answer. Approve once makes the same call as the run's with
 * `approved`; Decline makes it without, so the invoke core refuses it
 * again and the run is told so (`useSandboxPorts`).
 */
import { DefaultActionApproval } from "./action-approval";
import type { Asking } from "../sandbox-run";

export function SandboxApprovalCard({ asking }: { readonly asking: Asking }) {
  const { invocation, answer } = asking;
  return (
    <section
      aria-label="The code asks for approval"
      className="mx-3 mb-3 shrink-0 rounded-sm border border-foreground/10 bg-card p-3"
      data-sandbox-approval="true"
    >
      <p className="text-ui text-foreground/80">
        This code asks to run <code className="font-mono">{invocation.id}</code>, which needs your
        approval.
      </p>
      <DefaultActionApproval invocation={invocation} answer={answer} />
    </section>
  );
}
