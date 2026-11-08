/** Governance composition; see DESIGN.md → Governance. */
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
  required:
    "Every call passes through it: while it is missing kb refuses calls rather than run them unguarded.",
  seed: governanceSeedNodes,
  files: GOVERNANCE_FILES,
});

/** Graph policies remain deferred; core owns declared approval. */
// GAP [[01M5E2DAVRH5CWKM27BVDYW19T]]
export const governancePlugin: Plugin = definePlugin({
  name: governanceExtension.name,
  tags: familyTags(governanceExtension),
  namespace: extensionNamespace(governanceExtension.name),
  apply: () => Effect.void,
});
