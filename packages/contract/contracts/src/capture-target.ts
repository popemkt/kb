/**
 * The capture target's write half (DESIGN.md → Provider roles): where a
 * node written with no chosen place goes, as an action handler asks it.
 * `node.add` and `node.addTree` take an omitted `parent` to mean this place,
 * whichever surface made the call: the CLI's `kb add`, an MCP tool call, a
 * script, a tab.
 *
 * It is the role `ui.capture-target` (`CAPTURE_TARGET_ROLE`) on the
 * registry kernel: one role node chooses its provider for the registry and
 * the page alike. Core's default answers the top level and writes nothing;
 * a family that replaces it (days, with today's node) answers a place and
 * what has to be made there first, and the add commits both as one
 * transaction.
 */
import { Context, Effect } from "effect";
import { DomainError, domainError, type KbNode, type NodeId } from "@kb/model";
import { Role, Service, roleCall, type Kernel } from "@kb/plugin";
import { CAPTURE_TARGET_ROLE } from "./roles.ts";

/** Where a capture goes: under `parent`, or the top level for null, once `upserts` are written. */
export interface CapturePlan {
  readonly parent: NodeId | null;
  /** What the place needs first (a day not made yet, say), written in the add's own transaction. */
  readonly upserts: readonly KbNode[];
}

/** The place for a capture into the store that holds `nodes`. */
export type CapturePlanner = (nodes: readonly KbNode[]) => Effect.Effect<CapturePlan, DomainError>;

/** The registry kernel's key of `ui.capture-target`; the page's is `CaptureTargetService` in `@kb/ui-sdk`. */
export const CapturePlannerService = Service<CapturePlanner>()(CAPTURE_TARGET_ROLE.role, {
  ...CAPTURE_TARGET_ROLE.spec,
  kernel: "registry",
});

const CapturePlannerRole = Role(CapturePlannerService);

/** Core's answer, the role's default: the top level, with nothing to make. */
export const topLevelPlan: CapturePlanner = () => Effect.succeed({ parent: null, upserts: [] });

/** How long the elected provider may take before the next candidate answers. */
const CAPTURE_BUDGET_MS = 5_000;

/** The capture target as `kernel`'s elected provider answers it, demoted to the next on a fault. */
export function kernelCaptureTarget(kernel: Kernel): CapturePlanner {
  return (nodes) =>
    roleCall(kernel, CapturePlannerRole, (plan) => plan(nodes), CAPTURE_BUDGET_MS).pipe(
      Effect.mapError((error) =>
        error instanceof DomainError
          ? error
          : domainError("internal", `no capture target answered: ${error.message}`),
      ),
    );
}

/**
 * The capture target an action handler reaches, given at the invoke tip by
 * each runtime: the registry's role on the server, the page's on a tab.
 */
export class CaptureTarget extends Context.Service<CaptureTarget, CapturePlanner>()(
  "kb/CaptureTarget",
) {}
