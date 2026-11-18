/**
 * The governance family's seed (DESIGN.md → Governance): the
 * `#approval-policy` tag and its fields, their option nodes, the query node
 * that lists every policy and its pin. It seeds no policy while
 * policies are deferred.
 * A store composed without the family is seeded with none of it, so it
 * holds no policy node.
 */
import { ACTORS, SYSTEM_IDS, seededField, seededTag, type KbNode } from "@kb/model";
import { APPROVAL_DECISIONS } from "@kb/contracts";
import {
  ACTOR_OPTION_IDS,
  APPROVAL_POLICIES_QUERY,
  DECISION_OPTION_IDS,
  GOVERNANCE_IDS,
} from "./policy.ts";

/** A plain node stamped `at`, for the family's seed. */
const plainNode =
  (at: string) =>
  (id: string, text: string, props: KbNode["props"] = {}): KbNode => ({
    id,
    text,
    props,
    children: [],
    createdAt: at,
    updatedAt: at,
  });

/** The vocabulary every policy is written in: its tag, its three fields, and their options. */
function vocabularyNodes(at: string): KbNode[] {
  const mk = plainNode(at);
  const singleField = (id: string, text: string, type: "text" | "ref"): KbNode =>
    seededField(id, text, type, at, { one: true });

  /*
   * Approval policies (DESIGN.md → Action registry → Approval). `#approval-policy`
   * is a kind — strip its decision and it is still a policy, badly filled in —
   * so it is a tag templating its three fields. Actors and decisions are option
   * sets of one field each, so they are those fields' children.
   */
  const approvalMatchField = singleField(GOVERNANCE_IDS.matchField, "approval.match", "text");
  const actorOptions = ACTORS.map((actor) => mk(ACTOR_OPTION_IDS[actor], actor));
  const approvalActorField: KbNode = {
    ...singleField(GOVERNANCE_IDS.actorField, "approval.actor", "ref"),
    children: actorOptions.map((option) => option.id),
  };
  const decisionOptions = APPROVAL_DECISIONS.map((decision) =>
    mk(DECISION_OPTION_IDS[decision], decision),
  );
  const approvalDecisionField: KbNode = {
    ...singleField(GOVERNANCE_IDS.decisionField, "approval.decision", "ref"),
    children: decisionOptions.map((option) => option.id),
  };
  const approvalPolicyTag = seededTag(
    GOVERNANCE_IDS.policyTag,
    "approval-policy",
    [GOVERNANCE_IDS.matchField, GOVERNANCE_IDS.actorField, GOVERNANCE_IDS.decisionField],
    at,
  );
  return [
    approvalMatchField,
    approvalActorField,
    ...actorOptions,
    approvalDecisionField,
    ...decisionOptions,
    approvalPolicyTag,
  ];
}

export function governanceSeedNodes(at: string): readonly KbNode[] {
  const mk = plainNode(at);
  // GAP [[01M5E2DAVRH5CWKM27BVDYW19T]] no default policy is seeded while policy guards are deferred.
  const approvalPolicies = mk(GOVERNANCE_IDS.policies, "Approval policies", {
    [SYSTEM_IDS.queryField]: [{ t: "str", v: APPROVAL_POLICIES_QUERY }],
  });
  // GAP [[01M413SPC35K20DFC4TRP4DJYH]]
  const approvalPoliciesPin = mk(GOVERNANCE_IDS.policiesPin, "", {
    [SYSTEM_IDS.refTargetField]: [{ t: "ref", v: GOVERNANCE_IDS.policies }],
  });

  return [...vocabularyNodes(at), approvalPolicies, approvalPoliciesPin];
}

/**
 * The family's pin is filed in core's Pinned list (`SeedSource.files`).
 */
export const GOVERNANCE_FILES = {
  [SYSTEM_IDS.pinnedRoot]: [GOVERNANCE_IDS.policiesPin],
} as const;
