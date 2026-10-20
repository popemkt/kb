/**
 * The governance family's seed (DESIGN.md → Governance): the
 * `#approval-policy` tag and its fields, their option nodes, the default
 * policies, the query node that lists every policy, its table and its pin.
 * A store composed without the family is seeded with none of it, so it
 * holds no policy node.
 */
import { ACTORS, SYSTEM_IDS, seededField, seededTag, viewOptionId, type KbNode } from "@kb/model";
import { APPROVAL_DECISIONS } from "@kb/contracts";
import {
  ACTOR_OPTION_IDS,
  APPROVAL_POLICIES_QUERY,
  DECISION_OPTION_IDS,
  GOVERNANCE_IDS,
  approvalPolicyNode,
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
  /*
   * The defaults the owner chose: an agent, and sandboxed code, is asked before
   * it deletes a node and before a store-wide rewrite; an agent is asked
   * before switching an extension, which code never does. Normal edits need no policy (no core
   * write declares approval), and a human's gesture never asks because the
   * gesture is the person's answer — a property of the resolver, not a row.
   * They are ordinary, editable nodes, filed under the query node that lists
   * every policy.
   */
  const defaultPolicies = [
    approvalPolicyNode(mk("approval.agent-delete", "An agent asks before deleting a node"), {
      match: "node.delete",
      actor: "agent",
      decision: "ask",
    }),
    approvalPolicyNode(
      mk("approval.agent-views-migrate", "An agent asks before rewriting the store to view nodes"),
      { match: "views.migrate", actor: "agent", decision: "ask" },
    ),
    // Sandboxed code is agent-written until a person trusts it, so it meets
    // the agent's caution: its host asks the person before these run.
    approvalPolicyNode(mk("approval.script-delete", "Sandboxed code asks before deleting a node"), {
      match: "node.delete",
      actor: "script",
      decision: "ask",
    }),
    approvalPolicyNode(
      mk(
        "approval.script-views-migrate",
        "Sandboxed code asks before rewriting the store to view nodes",
      ),
      { match: "views.migrate", actor: "script", decision: "ask" },
    ),
    // Trusting code is a person's own gesture, made where the code is shown
    // (DESIGN.md → Sandbox → Trust): no agent trusts code for them, and no
    // code trusts itself.
    approvalPolicyNode(mk("approval.agent-trust", "An agent never trusts code"), {
      match: "sandbox.trust",
      actor: "agent",
      decision: "deny",
    }),
    approvalPolicyNode(mk("approval.script-trust", "Sandboxed code never trusts code"), {
      match: "sandbox.trust",
      actor: "script",
      decision: "deny",
    }),
    // Switching an optional extension changes which code the server loads
    // (DESIGN.md → Extension families): an agent asks the person, and
    // sandboxed code never does it.
    approvalPolicyNode(
      mk("approval.agent-extension-switch", "An agent asks before switching an extension"),
      { match: "extension.switch", actor: "agent", decision: "ask" },
    ),
    approvalPolicyNode(
      mk("approval.script-extension-switch", "Sandboxed code never switches an extension"),
      { match: "extension.switch", actor: "script", decision: "deny" },
    ),
  ];
  /*
   * Policies are managed in a saved table of every `#approval-policy` node,
   * pinned in the sidebar; there is no settings page. The table is an
   * ordinary frame view node over the query node's results, its columns the
   * three fields, so its sort, widths and filters are edited like any view's.
   * The table is the collections family's, which may be switched off; the
   * list, core's other frame view, reads none of the columns, widths or page
   * size the policies are shown by. GAP [[01M536CH4P48SXV9B0HH8B4XTG]]
   */
  const approvalPoliciesView = mk(GOVERNANCE_IDS.policiesView, "", {
    [SYSTEM_IDS.viewField]: [{ t: "ref", v: viewOptionId("outline.table") }],
    [SYSTEM_IDS.viewDisplayField]: [
      { t: "ref", v: GOVERNANCE_IDS.matchField },
      { t: "ref", v: GOVERNANCE_IDS.actorField },
      { t: "ref", v: GOVERNANCE_IDS.decisionField },
    ],
  });
  const approvalPolicies: KbNode = {
    ...mk(GOVERNANCE_IDS.policies, "Approval policies", {
      [SYSTEM_IDS.queryField]: [{ t: "str", v: APPROVAL_POLICIES_QUERY }],
      [SYSTEM_IDS.viewsField]: [{ t: "ref", v: GOVERNANCE_IDS.policiesView }],
    }),
    children: defaultPolicies.map((policy) => policy.id),
  };
  // GAP [[01M413SPC35K20DFC4TRP4DJYH]]
  const approvalPoliciesPin = mk(GOVERNANCE_IDS.policiesPin, "", {
    [SYSTEM_IDS.refTargetField]: [{ t: "ref", v: GOVERNANCE_IDS.policies }],
  });

  return [
    ...vocabularyNodes(at),
    approvalPolicies,
    ...defaultPolicies,
    approvalPoliciesView,
    approvalPoliciesPin,
  ];
}

/**
 * Where the family's nodes are filed among core's lists: its table among
 * the Views, its pin among the Pinned (`SeedSource.files`).
 */
export const GOVERNANCE_FILES = {
  [SYSTEM_IDS.viewsList]: [GOVERNANCE_IDS.policiesView],
  [SYSTEM_IDS.pinnedRoot]: [GOVERNANCE_IDS.policiesPin],
} as const;
