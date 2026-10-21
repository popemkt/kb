/**
 * The governance family's shared package (DESIGN.md → Extension families,
 * Governance): its declaration and its one plugin, which every host loads,
 * and the policy vocabulary and resolver its guard reads.
 */
export { governanceExtension, governancePlugin } from "./extension.ts";
// The guards the plugin contributes again once policies are re-introduced. GAP [[01M5E2DAVRH5CWKM27BVDYW19T]]
export { approvalGuard, forceGuard } from "./approval.ts";
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
