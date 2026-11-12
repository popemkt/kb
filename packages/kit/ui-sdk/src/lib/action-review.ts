/** Action-specific evidence is contributed once and shared by every approval surface. */
import { CORE_POINT_DEFINITIONS } from "@kb/contracts";
import type { ReactNode } from "react";
import type { ActionInvocation } from "@kb/contracts";
import { Point } from "@kb/plugin";

export interface ApprovalView {
  readonly content: ReactNode;
  readonly approveLabel: string;
}

export interface ActionReview {
  readonly action: string;
  /** Null retains the default review for inputs this contribution does not describe; the next matching review may describe it. */
  readonly read: (invocation: ActionInvocation) => Promise<ApprovalView | null>;
}

export const ActionReviewPoint = Point<ActionReview>()(
  CORE_POINT_DEFINITIONS.actionReview.name,
  CORE_POINT_DEFINITIONS.actionReview.spec,
);

/** Matching reviews describe disjoint inputs; a failed reader never falls through to generic approval. */
export async function readActionReviews(
  reviews: readonly ActionReview[],
  invocation: ActionInvocation,
): Promise<ApprovalView | null> {
  for (const review of reviews) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- Order elects the first matching review; later readers must not run after a match or failure.
    const view = await review.read(invocation);
    if (view !== null) return view;
  }
  return null;
}
