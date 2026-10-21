/**
 * The governance family (DESIGN.md → Action registry → Interception, and
 * Core boundary & extensions → governance): what a call may do, as guards
 * on the invoke core's guard point, and the policies they read. Core
 * decides nothing about a call by policy. The family holds the policy
 * vocabulary, the resolver and its guards (approval, and the owner's
 * `force`); for now it ships no rule that bites: its plugin contributes no
 * guard and its seed holds no policy, so every call runs, and who made it is
 * only recorded (DESIGN.md → Approval → Current stance). It is required: a
 * store cannot switch it off, and a deployment that runs without governance
 * leaves it out of its composition (`kb --governance off`), never by a graph
 * write.
 */
import { Effect } from "effect";
import { defineExtension, extensionNamespace, familyTags } from "@kb/contracts";
import { definePlugin, type Plugin } from "@kb/plugin";
import { GOVERNANCE_FILES, governanceSeedNodes } from "./seed.ts";

/**
 * The family's declaration: its seed is the policy vocabulary and the table
 * that lists policies, so a composition that leaves the family out seeds
 * none of it.
 */
export const governanceExtension = defineExtension({
  name: "governance",
  label: "Governance",
  tags: ["governance"],
  seed: governanceSeedNodes,
  files: GOVERNANCE_FILES,
});

/**
 * The family's plugin, the same on the server and in the page. It
 * contributes no guard while policies are deferred: `approvalGuard` and
 * `forceGuard` (`approval.ts`) are what it contributes again, approval
 * first, once they are re-introduced.
 */
// GAP [[01M5E2DAVRH5CWKM27BVDYW19T]]
export const governancePlugin: Plugin = definePlugin({
  name: governanceExtension.name,
  tags: familyTags(governanceExtension),
  namespace: extensionNamespace(governanceExtension.name),
  apply: () => Effect.void,
});
