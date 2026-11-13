/**
 * Where a node made with no chosen place goes (DESIGN.md → Provider roles):
 * the page role `ui.capture-target`, whose provider answers the parent's
 * id, or null for the top level. Core owns the role, and its default,
 * {@link topLevelCapture}, answers the top level; a family that replaces
 * it (days, with today's node) is elected over it as any replacement is.
 */
import { Effect } from "effect";
import { CAPTURE_TARGET_ROLE, type CapturePlanner } from "@kb/contracts";
import { domainError } from "@kb/model";
import { Role, Service } from "@kb/plugin";
import { callPageRole } from "./plugins.ts";

/** The parent a capture goes under, or null for the top level. */
export type PageCaptureTarget = () => Promise<string | null>;

/** The page kernel's key of `ui.capture-target`; the registry's is `CapturePlannerService` in `@kb/contracts`. */
export const CaptureTargetService = Service<PageCaptureTarget>()(CAPTURE_TARGET_ROLE.role, {
  ...CAPTURE_TARGET_ROLE.spec,
  kernel: "page",
});

const CaptureTargetRole = Role(CaptureTargetService);

/** Core's answer, the role's default: a capture goes to the top level. */
export const topLevelCapture: PageCaptureTarget = () => Promise.resolve(null);

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

/**
 * The page's capture target as an action handler on this page asks it
 * (`CaptureTarget`): a `node.add` with no parent, run in the tab, lands
 * where the page's own captures do, in the page's day. Nothing is left to
 * make, as a page provider makes its place before it answers.
 */
export const pageCapturePlanner: CapturePlanner = () =>
  Effect.tryPromise({
    try: captureTarget,
    catch: (cause) =>
      domainError(
        "internal",
        `no capture target answered: ${cause instanceof Error ? cause.message : String(cause)}`,
      ),
  }).pipe(Effect.map((parent) => ({ parent, upserts: [] })));
