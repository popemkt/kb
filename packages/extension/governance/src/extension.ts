/**
 * The governance family (DESIGN.md → Action registry → Interception, and
 * Core boundary & extensions → governance): what a call may do, as guards
 * on the invoke core's guard point, and the policies they read. Core
 * decides nothing about a call by policy; this family's plugin contributes
 * approval (the policies and each action's declared mode) and the owner's
 * `force`, and its seed is every policy node a store holds. It is required: a store cannot
 * switch it off, and a deployment that runs without governance leaves it
 * out of its composition (`kb --governance off`), never by a graph write.
 */
import { Effect } from "effect";
import { ActionGuardPoint, defineExtension, extensionNamespace } from "@kb/contracts";
import { definePlugin, type Plugin } from "@kb/plugin";
import { approvalGuard, forceGuard } from "./approval.ts";
import { GOVERNANCE_FILES, governanceSeedNodes } from "./seed.ts";

/**
 * The family's declaration: its seed is the whole of the policy vocabulary
 * and the default policies, so a composition that leaves the family out
 * seeds no policy node.
 */
export const governanceExtension = defineExtension({
  name: "governance",
  label: "Governance",
  seed: governanceSeedNodes,
  files: GOVERNANCE_FILES,
});

/**
 * The family's plugin, the same on the server and in the page: its guards,
 * approval first. The page loads it when the server reports the family
 * loaded, so a local call is decided as the server decides it.
 */
export const governancePlugin: Plugin = definePlugin({
  name: governanceExtension.name,
  namespace: extensionNamespace(governanceExtension.name),
  apply: (plugin) =>
    Effect.gen(function* () {
      yield* plugin.contribute(ActionGuardPoint, { id: "approval", value: approvalGuard });
      yield* plugin.contribute(ActionGuardPoint, { id: "force", value: forceGuard });
    }),
});
