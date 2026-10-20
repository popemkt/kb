/**
 * The vocabulary of approval policies (DESIGN.md → Governance): the
 * `#approval-policy` nodes that decide about a call, the option nodes they
 * name an actor and a decision by, and what a write to them is. The
 * governance family's own: its seed writes them and its guard reads them,
 * so a composition without the family has neither.
 */
import {
  ACTORS,
  SYSTEM_IDS,
  actsAsOwner,
  type Actor,
  type KbNode,
  type NodeId,
  type NodeWrite,
} from "@kb/model";
import { APPROVAL_DECISIONS, type ApprovalDecision } from "@kb/contracts";

/**
 * The governance family's node ids (DESIGN.md → Extension families → Ids
 * are frozen data): an ordinary node tagged `#approval-policy` says what is
 * decided about a call. `match` names the actions (str, one), `actor` who
 * calls (a ref to one of its option children; absent means every actor),
 * `decision` what happens (a ref to one of its option children).
 */
export const GOVERNANCE_IDS = {
  policyTag: "sys.tag.approval-policy",
  matchField: "sys.f.approval.match",
  actorField: "sys.f.approval.actor",
  decisionField: "sys.f.approval.decision",
  /**
   * Where the seeded default policies are filed: a query node over every
   * `#approval-policy` node, so a policy filed anywhere shows there too.
   * User-editable (NOT sys-prefixed): its view and its children are the
   * person's to arrange.
   */
  policies: "approval.policies",
  /**
   * How the policies are managed: a table view node over that query's
   * results, filed in the Views list and named by the query node, and the
   * contextual reference that pins the query node in the sidebar. Both
   * user-editable, as every view node and every pin is.
   */
  policiesView: "view.approval.policies",
  policiesPin: "pin.approval.policies",
} as const;

/**
 * What a governing write needs from a caller acting for the owner: an agent
 * asks the owner first, and sandboxed code, which runs what no person wrote
 * for this, never makes it.
 */
const DELEGATED: Readonly<Record<Exclude<Actor, "human" | "cli">, ApprovalDecision>> = {
  agent: "ask",
  script: "deny",
};

/**
 * What a governing write needs, by who makes it: a write to configuration
 * (what the code runs with), or one that reaches past the store's root. The
 * owner's own actors make it as any write, and a caller acting for them as
 * `DELEGATED` says.
 */
export function delegatedDecision(actor: Actor): ApprovalDecision {
  return actsAsOwner(actor) ? "allow" : DELEGATED[actor];
}

/** The stricter of two decisions. */
export function stricterDecision(a: ApprovalDecision, b: ApprovalDecision): ApprovalDecision {
  return APPROVAL_DECISIONS.indexOf(a) >= APPROVAL_DECISIONS.indexOf(b) ? a : b;
}

/**
 * The option nodes a policy's `actor` and `decision` refer to: the children
 * of those fields (DESIGN.md → Kinds, roles and options). A policy names an
 * option by its id, never by its text, so renaming an option changes nothing
 * a policy decides.
 */
export const ACTOR_OPTION_IDS: Readonly<Record<Actor, NodeId>> = {
  human: "sys.approval.actor.human",
  agent: "sys.approval.actor.agent",
  cli: "sys.approval.actor.cli",
  script: "sys.approval.actor.script",
};
export const DECISION_OPTION_IDS: Readonly<Record<ApprovalDecision, NodeId>> = {
  allow: "sys.approval.decision.allow",
  ask: "sys.approval.decision.ask",
  deny: "sys.approval.decision.deny",
};

/** One `#approval-policy` node, as the resolver reads it. */
export interface ApprovalPolicy {
  readonly id: NodeId;
  /** An action id, a pattern with `*` (any run of characters), or a mode word (`MODE_MATCHES`, `action-match.ts`). */
  readonly match: string;
  /** The actor it is about; `null` is every actor. */
  readonly actor: Actor | null;
  readonly decision: ApprovalDecision;
}

function firstRef(node: KbNode, field: NodeId): NodeId | undefined {
  return node.props[field]?.find((value) => value.t === "ref")?.v;
}

function isPolicyNode(node: KbNode): boolean {
  return (node.props[SYSTEM_IDS.typeField] ?? []).some(
    (value) => value.t === "ref" && value.v === GOVERNANCE_IDS.policyTag,
  );
}

/**
 * The policies among `nodes`: every node tagged `#approval-policy` that names
 * what it matches and what it decides. One that names neither, or names an
 * actor or a decision that is no option, decides nothing: a half-written
 * policy is skipped rather than guessed at.
 */
export function approvalPoliciesOf(nodes: Iterable<KbNode>): ApprovalPolicy[] {
  const policies: ApprovalPolicy[] = [];
  for (const node of nodes) {
    if (!isPolicyNode(node)) continue;
    const match = node.props[GOVERNANCE_IDS.matchField]
      ?.find((value) => value.t === "str")
      ?.v.trim();
    const decisionRef = firstRef(node, GOVERNANCE_IDS.decisionField);
    const decision = APPROVAL_DECISIONS.find((value) => DECISION_OPTION_IDS[value] === decisionRef);
    const actorRef = firstRef(node, GOVERNANCE_IDS.actorField);
    const actor =
      actorRef === undefined ? null : ACTORS.find((value) => ACTOR_OPTION_IDS[value] === actorRef);
    if (match === undefined || match === "" || decision === undefined || actor === undefined) {
      continue;
    }
    policies.push({ id: node.id, match, actor, decision });
  }
  return policies;
}

/** The tag, the fields and the option nodes every policy is written in. */
const APPROVAL_VOCABULARY: ReadonlySet<NodeId> = new Set([
  GOVERNANCE_IDS.policyTag,
  GOVERNANCE_IDS.matchField,
  GOVERNANCE_IDS.actorField,
  GOVERNANCE_IDS.decisionField,
  ...Object.values(ACTOR_OPTION_IDS),
  ...Object.values(DECISION_OPTION_IDS),
]);

/**
 * Whether a write changes what the policies decide: it writes a policy (one
 * tagged before or after, so tagging and untagging count), or the vocabulary
 * every policy is written in.
 */
export function writesApprovalPolicy(write: NodeWrite): boolean {
  const id = write.after?.id ?? write.before?.id;
  if (id !== undefined && APPROVAL_VOCABULARY.has(id)) return true;
  return [write.before, write.after].some((node) => node !== undefined && isPolicyNode(node));
}

/** The datalog query for every `#approval-policy` node, as a query node runs it. */
export const APPROVAL_POLICIES_QUERY = `[:find ?id :where [?n :f/${SYSTEM_IDS.typeField} ?t] [?t :node/id "${GOVERNANCE_IDS.policyTag}"] [?n :node/id ?id]]`;

/** A policy node, as the seed writes its defaults. */
export function approvalPolicyNode(base: KbNode, policy: Omit<ApprovalPolicy, "id">): KbNode {
  return {
    ...base,
    props: {
      ...base.props,
      [SYSTEM_IDS.typeField]: [{ t: "ref", v: GOVERNANCE_IDS.policyTag }],
      [GOVERNANCE_IDS.matchField]: [{ t: "str", v: policy.match }],
      ...(policy.actor === null
        ? {}
        : { [GOVERNANCE_IDS.actorField]: [{ t: "ref", v: ACTOR_OPTION_IDS[policy.actor] }] }),
      [GOVERNANCE_IDS.decisionField]: [{ t: "ref", v: DECISION_OPTION_IDS[policy.decision] }],
    },
  };
}
