/** Governance composition; see DESIGN.md → Governance. */
import { declarationPlugin, defineExtension } from "@kb/contracts";
import { policiesViewMigration } from "./policies-view-migration.ts";
import { GOVERNANCE_FILES, governanceSeedNodes } from "./seed.ts";

/**
 * The family's declaration: its seed is the policy vocabulary and the query
 * that lists policies, so a composition that leaves the family out seeds
 * none of it.
 */
export const governanceExtension = defineExtension({
  name: "governance",
  label: "Governance",
  manifest: { description: "The vocabulary for approval policies; every call passes its guard." },
  tags: ["governance"],
  required:
    "Every call passes through it: while it is missing kb refuses calls rather than run them unguarded.",
  seed: governanceSeedNodes,
  files: GOVERNANCE_FILES,
  migrations: [policiesViewMigration],
});

/** Graph policies remain deferred; core owns declared approval. */
// GAP [[01M5E2DAVRH5CWKM27BVDYW19T]]
export const governancePlugin = declarationPlugin(governanceExtension);
