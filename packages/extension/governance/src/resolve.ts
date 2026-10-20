/**
 * The resolver (DESIGN.md → Governance, Action registry → Approval): what
 * the policies, each action's declared mode and the governing-write rule
 * decide about a call, and what a refused call is refused with. Read by the
 * family's approval guard alone; nothing else in kb decides by policy.
 */
import {
  changedFields,
  configuresAnExtension,
  matchSpecificity,
  typeRefsOf,
  type Actor,
  type KbNode,
  type NodeId,
  type NodeLike,
  type NodeOf,
  type NodeWrite,
} from "@kb/model";
import {
  hasPerson,
  requiresApproval,
  type ActionInvocation,
  type ActionMode,
  type ApprovalDecision,
  type CalledAction,
  type ShownConfiguration,
} from "@kb/contracts";
import {
  delegatedDecision,
  stricterDecision,
  writesApprovalPolicy,
  type ApprovalPolicy,
} from "./policy.ts";

/**
 * Whether a write's mode delegates its approval: it says so
 * (`approval: "delegated"`), or it reaches outside its root (`outsideRoot`:
 * another store on this machine, or a process it starts), which always
 * does.
 */
function delegatesApproval(mode: ActionMode): boolean {
  return mode.kind === "write" && (mode.approval === "delegated" || mode.outsideRoot === true);
}

/**
 * What an action's own mode decides about a call to it by `actor`: `ask`
 * where it requires approval, and where it delegates approval
 * (`delegatesApproval`) at least what a governing write needs from that
 * actor (`delegatedDecision`): the owner's own actors run it, an agent asks,
 * sandboxed code is denied. The family that declares the mode declares the
 * floor; no policy node has to be written for it.
 */
export function declaredDecision(mode: ActionMode, actor: Actor): ApprovalDecision {
  const declared = requiresApproval(mode) ? "ask" : "allow";
  if (!delegatesApproval(mode)) return declared;
  return stricterDecision(declared, delegatedDecision(actor));
}

/**
 * One call, as the resolver weighs it: the action, who calls, and — once the
 * handler has worked it out, just before it commits — the nodes it writes.
 */
export interface ApprovalCall {
  readonly action: CalledAction;
  readonly actor: Actor;
  readonly writes?: readonly NodeWrite[];
  /** How the writes' fields, kinds and named nodes are read: the graph before the commit. */
  readonly nodeOf?: (id: NodeId) => NodeLike | undefined;
}

/** What a governing write changes: the approval policies, or an extension's configuration. */
export type GoverningWrite = "approval-policy" | "configuration";

/** What is decided about one call, and what decided it. */
export interface ApprovalResolution {
  readonly decision: ApprovalDecision;
  /**
   * The policy that decided (its id), the action's declared mode (`mode`),
   * or the rule that a governing write is made only with a person behind
   * the call (`{writes}`): any write to a policy, and a write to
   * configuration by a caller acting for the owner.
   */
  readonly by: { readonly policy: string } | "mode" | { readonly writes: GoverningWrite };
  /** For a write to configuration: what it runs with, shown to the person asked. */
  readonly shows?: readonly ShownConfiguration[];
}

/**
 * The one resolver: what is decided about a call.
 *
 * - A policy applies when its `match` names the action and its actor is the
 *   call's, or it names no actor. Every call names its actor
 *   (`ActionInvocation`).
 * - The most specific policy wins: by its match (the action's own id, then a
 *   pattern by its literal characters, then a mode word, then a bare `*`),
 *   then one naming the actor over one naming none, then the stricter
 *   decision, so two policies that tie never depend on their order.
 * - With none, the action's declared mode decides ({@link declaredDecision}),
 *   for the call's actor.
 * - An action that declares itself a batch of others (`batchOf`) is decided
 *   as itself and as each of them, each with the mode its own definition
 *   declares, and the stricter decision holds; on a tie its own. A batch can never be allowed where
 *   one of the calls it makes would ask or be denied.
 * - A declared approval is a floor that only a policy naming the action by its
 *   own id can lower. Its author said every call needs a person; a pattern or
 *   a mode word written for many actions does not unsay it by accident, while
 *   a person who names the action means it.
 * - A governing write asks, whatever the policies say: a call that writes a
 *   policy, or the vocabulary policies are written in (otherwise a caller
 *   could allow itself), and a call that writes an extension's
 *   configuration (`writesConfiguration`: what the code runs with, such as
 *   the endpoint a key is sent to), as `delegatedDecision` says for its
 *   actor: the owner's make it, an agent asks, sandboxed code is denied.
 *   That is known only from its writes, so the invoke core asks again with
 *   them just before the commit, and nothing is written when it refuses. A
 *   denial stays a denial.
 */
export function resolveApproval(
  policies: readonly ApprovalPolicy[],
  call: ApprovalCall,
): ApprovalResolution {
  const ruled = byPolicy(policies, call);
  if (ruled.decision === "deny") return ruled;
  const writes = call.writes ?? [];
  if (writes.some(writesApprovalPolicy)) {
    return { decision: "ask", by: { writes: "approval-policy" } };
  }
  const { nodeOf } = call;
  if (nodeOf === undefined || !writes.some((write) => writesConfiguration(write, nodeOf))) {
    return ruled;
  }
  const decision = delegatedDecision(call.actor);
  if (decision === "allow") return ruled;
  const shows = configurationShown(writes, nodeOf);
  return { decision, by: { writes: "configuration" }, ...(shows.length > 0 ? { shows } : {}) };
}

function byPolicy(policies: readonly ApprovalPolicy[], call: ApprovalCall): ApprovalResolution {
  const { action, actor } = call;
  let decided = byPolicyAs(policies, action, actor);
  for (const part of action.batchOf ?? []) {
    const as = byPolicyAs(policies, part, actor);
    if (stricterDecision(as.decision, decided.decision) !== decided.decision) decided = as;
  }
  return decided;
}

/** What the policies decide about a call to `action` by `actor`, the action taken as it declares itself. */
function byPolicyAs(
  policies: readonly ApprovalPolicy[],
  action: { readonly id: string; readonly mode: ActionMode },
  actor: Actor,
): ApprovalResolution {
  const declared = declaredDecision(action.mode, actor);
  let best: { policy: ApprovalPolicy; rank: readonly number[] } | null = null;
  for (const policy of policies) {
    if (policy.actor !== null && policy.actor !== actor) continue;
    const specificity = matchSpecificity(policy.match, action);
    if (specificity === null) continue;
    const rank = [...specificity, policy.actor === null ? 0 : 1];
    if (best === null || outranks(rank, policy, best)) best = { policy, rank };
  }
  if (best === null) return { decision: declared, by: "mode" };
  const exact = best.policy.match === action.id;
  return {
    decision: exact ? best.policy.decision : stricterDecision(best.policy.decision, declared),
    by: { policy: best.policy.id },
  };
}

function outranks(
  rank: readonly number[],
  policy: ApprovalPolicy,
  best: { policy: ApprovalPolicy; rank: readonly number[] },
): boolean {
  for (let i = 0; i < rank.length; i++) {
    const a = rank[i] ?? 0;
    const b = best.rank[i] ?? 0;
    if (a !== b) return a > b;
  }
  return stricterDecision(policy.decision, best.policy.decision) !== best.policy.decision;
}

/** Why a call may not run: the failure it is refused with. */
export interface ApprovalRefusal {
  readonly code: "forbidden" | "approval_required";
  readonly message: string;
  readonly details?:
    | { readonly policy: string }
    | {
        readonly writes: GoverningWrite;
        /** What a write to configuration runs with ({@link ApprovalResolution.shows}). */
        readonly configuration?: readonly ShownConfiguration[];
      };
}

/**
 * What the invoke core refuses a call with, or `null` when it may run: a
 * denied call never runs, and a call that asks runs only with a person
 * behind it ({@link hasPerson}).
 */
export function approvalRefusal(
  resolution: ApprovalResolution,
  invocation: ActionInvocation,
): ApprovalRefusal | null {
  const { id } = invocation;
  const { decision, by } = resolution;
  if (decision === "allow" || (decision === "ask" && hasPerson(invocation))) return null;
  if (by === "mode") {
    if (decision === "deny") {
      return {
        code: "forbidden",
        message: `action ${id} reaches outside its kb root, which a call by ${invocation.actor} never does`,
      };
    }
    return {
      code: "approval_required",
      message: `action ${id} requires approval; this call has none`,
    };
  }
  if ("writes" in by) {
    const caller = invocation.actor;
    if (decision === "deny") {
      return {
        code: "forbidden",
        message: `action ${id} writes an extension's configuration, which a call by ${caller} never changes`,
        details: { writes: by.writes },
      };
    }
    const message =
      by.writes === "approval-policy"
        ? `action ${id} writes an approval policy, which always needs a person's approval; this call has none`
        : `action ${id} writes an extension's configuration, which a call by ${caller} makes only with the owner's approval; this call has none`;
    const shows = resolution.shows === undefined ? {} : { configuration: resolution.shows };
    return { code: "approval_required", message, details: { writes: by.writes, ...shows } };
  }
  if (decision === "deny") {
    return {
      code: "forbidden",
      message: `action ${id} is denied to ${invocation.actor} by approval policy ${by.policy}`,
      details: { policy: by.policy },
    };
  }
  return {
    code: "approval_required",
    message: `action ${id} asks for approval under policy ${by.policy}; this call has none`,
    details: { policy: by.policy },
  };
}

/**
 * Whether a write changes an extension's configuration (DESIGN.md → Action
 * registry → Approval → configuration): a value of a field that configures
 * an extension, on whichever node it is written, or a node of a kind that
 * configures an extension (tagged before or after, so tagging and untagging
 * count, and so does minting or deleting one). `nodeOf` reads the fields
 * and kinds as the graph holds them before the write. What configuration
 * holds decides what the code runs with (a provider's endpoint and the key
 * it is sent), so a caller acting for the owner changes it only with the
 * owner's approval. A field's value counts wherever it lands, not only on
 * the node the field is a setting of: a node the configuration may later
 * name (a provider an untagged node could be made into) carries it already.
 */
export function writesConfiguration(write: NodeWrite, nodeOf: NodeOf): boolean {
  const { before, after } = write;
  const kinds = new Set([...typeRefsOf(before), ...typeRefsOf(after)]);
  if ([...kinds].some((kind) => configuresAnExtension(kind, nodeOf(kind)))) return true;
  return changedFields(before, after).some((field) => configuresAnExtension(field, nodeOf(field)));
}

/**
 * What a write to configuration runs with, for the person asked to approve
 * it: each node it configures, with its settings as they will be, and each
 * node such a setting names (the provider a selection points at), with that
 * node's settings, since approving the reference approves what it brings.
 * A credential shows its reference, which is all the graph ever holds.
 */
export function configurationShown(
  writes: readonly NodeWrite[],
  nodeOf: (id: NodeId) => NodeLike | undefined,
): ShownConfiguration[] {
  const shown = new Map<NodeId, ShownConfiguration>();
  const valueOf = (value: KbNode["props"][string][number]): string => {
    if (value.t === "ref") {
      const named = nodeOf(value.v);
      return named === undefined || named.text === "" ? value.v : `${named.text} (${value.v})`;
    }
    return typeof value.v === "string" ? value.v : JSON.stringify(value.v);
  };
  const show = (node: Pick<NodeLike, "id" | "text" | "props">): void => {
    if (shown.has(node.id)) return;
    const settings = Object.entries(node.props)
      .filter(([field]) => configuresAnExtension(field, nodeOf(field)))
      .map(([field, values]) => ({
        field,
        label: nodeOf(field)?.text ?? field,
        values: values.map(valueOf),
      }));
    if (settings.length === 0) return;
    shown.set(node.id, { node: node.id, label: node.text === "" ? node.id : node.text, settings });
    for (const value of settings.flatMap(({ field }) => node.props[field] ?? [])) {
      const named = value.t === "ref" ? nodeOf(value.v) : undefined;
      if (named !== undefined) show(named);
    }
  };
  for (const write of writes) {
    if (!writesConfiguration(write, nodeOf)) continue;
    const node = write.after ?? write.before;
    if (node !== undefined) show(node);
  }
  return [...shown.values()];
}
