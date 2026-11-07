/**
 * The governance family's shared package (DESIGN.md → Extension families,
 * Governance): its declaration and its one plugin, which every host loads,
 * and the policy vocabulary. Policy enforcement remains deferred.
 */
export { governanceExtension, governancePlugin } from "./extension.ts";
export {
  ACTOR_OPTION_IDS,
  APPROVAL_POLICIES_QUERY,
  DECISION_OPTION_IDS,
  GOVERNANCE_IDS,
  approvalPoliciesOf,
  approvalPolicyNode,
  type ApprovalPolicy,
} from "./policy.ts";
