import { Effect } from "effect";
import {
  approvalRefusal,
  resolveApproval,
  type ActionGuard,
  type ActionInvocation,
  type ApprovalCall,
  type ApprovalResolution,
  type GuardVerdict,
  type KbContext,
} from "@kb/contracts";
import { approvalPoliciesOf, type ApprovalPolicy } from "@kb/model";
import type { KbIndex } from "@kb/query";

/**
 * The policies a session holds, read once per index generation: every write
 * moves the generation, so a policy written a moment ago decides the next
 * call, and a run of calls between writes reads the graph once.
 */
const held = new WeakMap<KbIndex, { generation: number; policies: readonly ApprovalPolicy[] }>();

function policiesOf(ctx: KbContext): readonly ApprovalPolicy[] {
  const cached = held.get(ctx.index);
  if (cached?.generation === ctx.index.generation) return cached.policies;
  const policies = approvalPoliciesOf(ctx.index.allNodes());
  held.set(ctx.index, { generation: ctx.index.generation, policies });
  return policies;
}

/** What the session's policies decide about `call`. */
function decide(ctx: KbContext, call: ApprovalCall): ApprovalResolution {
  return resolveApproval(policiesOf(ctx), call);
}

/** The rule a resolution names: the policy, the action's declared mode, or the governing write. */
function ruleOf({ by }: ApprovalResolution): string {
  if (by === "mode") return "mode";
  return "policy" in by ? by.policy : `writes:${by.writes}`;
}

/**
 * A resolution as a guard's verdict. Listed, it is the decision itself;
 * about to run, it is what the call is refused with, if anything: an ask
 * with a person behind the call is no refusal.
 */
function verdictOf(
  resolution: ApprovalResolution,
  invocation: ActionInvocation,
  phase: "list" | "invoke",
): GuardVerdict {
  if (phase === "list") {
    if (resolution.decision === "allow") return { decision: "allow" };
    return { decision: resolution.decision, rule: ruleOf(resolution), message: "" };
  }
  const refusal = approvalRefusal(resolution, invocation);
  if (refusal === null) return { decision: "allow" };
  return {
    decision: refusal.code === "forbidden" ? "deny" : "ask",
    rule: ruleOf(resolution),
    message: refusal.message,
    ...(refusal.details === undefined ? {} : { details: refusal.details }),
  };
}

/**
 * Approval as a guard on every call: the session's policies and each
 * action's declared mode decide it before it runs, and again before it
 * commits, with what it writes (`resolveApproval`).
 */
export const approvalGuard: ActionGuard = {
  match: "*",
  before: ({ ctx, invocation, action, phase }) =>
    Effect.sync(() =>
      verdictOf(decide(ctx, { action, actor: invocation.actor }), invocation, phase),
    ),
  commit: ({ ctx, invocation, action, writes, nodeOf }) =>
    Effect.sync(() =>
      verdictOf(
        decide(ctx, { action, actor: invocation.actor, writes, nodeOf }),
        invocation,
        "invoke",
      ),
    ),
};
