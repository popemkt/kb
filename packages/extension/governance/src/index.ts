/**
 * The governance family's shared package (DESIGN.md → Extension families,
 * Governance): its declaration and its one plugin, which every host loads,
 * and the policy vocabulary and resolver its guard reads.
 */
export { governanceExtension, governancePlugin } from "./extension.ts";
export {
  ACTOR_OPTION_IDS,
  APPROVAL_POLICIES_QUERY,
  DECISION_OPTION_IDS,
  GOVERNANCE_IDS,
  approvalPoliciesOf,
  approvalPolicyNode,
  delegatedDecision,
  stricterDecision,
  writesApprovalPolicy,
  type ApprovalPolicy,
} from "./policy.ts";
export {
  approvalRefusal,
  configurationShown,
  declaredDecision,
  resolveApproval,
  writesConfiguration,
  type ApprovalCall,
  type ApprovalRefusal,
  type ApprovalResolution,
  type GoverningWrite,
} from "./resolve.ts";
