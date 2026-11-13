/** One action review and its decision controls, independent of the asking surface. */
import { useEffect, useMemo, useState } from "react";
import type { ActionInvocation } from "@kb/contracts";
import {
  ActionReviewPoint,
  readActionReviews,
  type ActionReview,
  type ApprovalView,
} from "../lib/action-review";
import { cn } from "../lib/cn";
import { useContributions } from "../lib/plugins.ts";

const BUTTON = cn(
  "rounded-sm px-2 py-1 text-label font-medium outline-none transition duration-100",
  "focus-visible:ring-2 focus-visible:ring-primary/60 disabled:cursor-default disabled:opacity-40",
);

interface ActionApprovalProps {
  readonly invocation: ActionInvocation;
  readonly answer: (approved: boolean) => void | Promise<void>;
}

interface DecisionProps {
  readonly answer: ActionApprovalProps["answer"];
  readonly approveLabel: string;
  readonly disabled?: boolean;
}

function ApprovalDecision({ answer, approveLabel, disabled = false }: DecisionProps) {
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  function decide(approved: boolean) {
    setPending(true);
    setProblem(null);
    return Promise.resolve()
      .then(() => answer(approved))
      .catch((error: unknown) => setProblem(error instanceof Error ? error.message : String(error)))
      .finally(() => setPending(false));
  }
  return (
    <>
      {problem !== null && (
        <p role="alert" className="mt-2 text-label text-destructive">
          {problem}
        </p>
      )}
      <div className="mt-2 flex justify-end gap-1">
        <button
          type="button"
          disabled={pending}
          className={cn(BUTTON, "text-foreground/60 hover:bg-foreground/[0.06]")}
          onClick={() => void decide(false)}
        >
          Decline
        </button>
        <button
          type="button"
          disabled={disabled || pending}
          className={cn(BUTTON, "bg-primary text-primary-foreground hover:bg-primary/90")}
          onClick={() => void decide(true)}
        >
          {approveLabel}
        </button>
      </div>
    </>
  );
}

function DefaultActionApproval({ invocation, answer }: ActionApprovalProps) {
  return (
    <>
      <pre className="mt-2 max-h-32 overflow-auto rounded-sm bg-background p-2 font-mono text-label text-foreground/70">
        {JSON.stringify(invocation.input, null, 2)}
      </pre>
      <ApprovalDecision answer={answer} approveLabel="Approve once" />
    </>
  );
}

interface Reading {
  readonly invocation: ActionInvocation;
  readonly reviews: readonly ActionReview[];
  readonly result: { readonly view: ApprovalView | null } | { readonly problem: string };
}

function ContributedApproval({
  invocation,
  answer,
  reviews,
}: ActionApprovalProps & { readonly reviews: readonly ActionReview[] }) {
  const [reading, setReading] = useState<Reading | null>(null);
  useEffect(() => {
    let live = true;
    void Promise.resolve()
      .then(() => readActionReviews(reviews, invocation))
      .then((view) => {
        if (live) setReading({ invocation, reviews, result: { view } });
      })
      .catch((error: unknown) => {
        if (live)
          setReading({
            invocation,
            reviews,
            result: { problem: error instanceof Error ? error.message : String(error) },
          });
      });
    return () => {
      live = false;
    };
  }, [invocation, reviews]);
  const result =
    reading?.invocation === invocation && reading.reviews === reviews ? reading.result : undefined;
  if (result !== undefined && "view" in result && result.view === null)
    return <DefaultActionApproval invocation={invocation} answer={answer} />;
  const view = result !== undefined && "view" in result ? result.view : null;
  return (
    <>
      {view?.content}
      {result === undefined && (
        <p role="status" className="mt-2 text-label text-foreground/60">
          Reading the review…
        </p>
      )}
      {result !== undefined && "problem" in result && (
        <p role="alert" className="mt-2 text-label text-destructive">
          {result.problem}
        </p>
      )}
      <ApprovalDecision
        answer={answer}
        approveLabel={view?.approveLabel ?? "Approve once"}
        disabled={view === null}
      />
    </>
  );
}

/** A review must finish successfully before approval; lookup failures never become generic approval. */
export function ActionApproval(props: ActionApprovalProps) {
  const contributions = useContributions(ActionReviewPoint);
  const reviews = useMemo(
    () =>
      contributions
        .filter(({ value }) => value.action === props.invocation.id)
        .map(({ value }) => value),
    [contributions, props.invocation.id],
  );
  return reviews.length === 0 ? (
    <DefaultActionApproval {...props} />
  ) : (
    <ContributedApproval {...props} reviews={reviews} />
  );
}
