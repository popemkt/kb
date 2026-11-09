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
  /** Null retains the default review for inputs this contribution does not describe. */
  readonly read: (invocation: ActionInvocation) => Promise<ApprovalView | null>;
}

export const ActionReviewPoint = Point<ActionReview>()(
  CORE_POINT_DEFINITIONS.actionReview.name,
  CORE_POINT_DEFINITIONS.actionReview.spec,
);
