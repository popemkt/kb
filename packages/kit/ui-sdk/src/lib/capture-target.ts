/**
 * Where a node made with no chosen place goes (DESIGN.md → Provider roles):
 * the page role `ui.capture-target`, whose provider answers the parent's
 * id, or null for the top level. Core owns the role, and its default,
 * {@link topLevelCapture}, answers the top level; a family that replaces
 * it (days, with today's node) is elected over it as any replacement is.
 */
import { CAPTURE_TARGET_ROLE } from "@kb/contracts";
import { Role, Service } from "@kb/plugin";
import { callPageRole } from "./plugins";

/** The parent a capture goes under, or null for the top level. */
export type CaptureTarget = () => Promise<string | null>;

export const CaptureTargetService = Service<CaptureTarget>()(
  CAPTURE_TARGET_ROLE.role,
  CAPTURE_TARGET_ROLE.spec,
);

const CaptureTargetRole = Role(CaptureTargetService);

/** Core's answer, the role's default: a capture goes to the top level. */
export const topLevelCapture: CaptureTarget = () => Promise.resolve(null);

/** How long the elected provider may take before the next candidate answers. */
const CAPTURE_BUDGET_MS = 5_000;

/**
 * The parent a node made with no chosen place goes under now; null is the
 * top level. Rejects when no candidate answered, which only a missing or
 * failing default can cause.
 */
export function captureTarget(): Promise<string | null> {
  return callPageRole(CaptureTargetRole, (target) => target(), CAPTURE_BUDGET_MS);
}
