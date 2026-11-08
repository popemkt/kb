/**
 * The docs family's shared package (DESIGN.md → Extension families): its
 * declaration, the one home of its name. The server entry (`@kb/ext-docs`)
 * reads it, and the bundled list (`@kb/bundled`) folds it.
 */
import { defineExtension } from "@kb/contracts";

export const docsExtension = defineExtension({
  name: "docs",
  label: "Docs",
  description: "Markdown docs rendered from queries and templates, and the generated-docs check.",
  tags: ["core"],
  required:
    "Core's markdown views render with its templates, and it runs the docs check this repository's gate relies on.",
});
