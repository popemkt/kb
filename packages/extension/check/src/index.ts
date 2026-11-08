/**
 * The check family's shared package (DESIGN.md → Extension families): its
 * declaration, the one home of its name. The server entry (`@kb/ext-check`)
 * reads it, and the bundled list (`@kb/bundled`) folds it.
 */
import { defineExtension } from "@kb/contracts";

export const checkExtension = defineExtension({
  name: "check",
  label: "Check",
  description: "The rule audit: every rule's check exists and runs where it says.",
  tags: ["core"],
  required:
    "It runs the rule audit the gates rely on, so no gate can read clean because it was switched off.",
});
