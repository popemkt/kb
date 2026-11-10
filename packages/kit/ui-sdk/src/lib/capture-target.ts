/**
 * Where a node made with no chosen place goes (DESIGN.md → Days): the
 * page role `ui.capture-target`, whose provider answers the parent's id,
 * or null for the top level. The days family owns it and answers today's
 * node. With no provider loaded, a capture goes to the top level.
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

/** A capture that waits longer than this goes to the top level. */
const CAPTURE_BUDGET_MS = 5_000;

/** The parent a node made with no chosen place goes under now; null is the top level. */
export async function captureTarget(): Promise<string | null> {
  return (await callPageRole(CaptureTargetRole, (target) => target(), CAPTURE_BUDGET_MS)) ?? null;
}
