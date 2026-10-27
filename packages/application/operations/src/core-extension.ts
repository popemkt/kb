/**
 * Core declared as the families are (DESIGN.md → Extension families): its
 * own system nodes, the views the shell is built from, in the order the
 * seed derives their options under `sys.views`, with the text a view says
 * itself in where it has one, and its one design system, the default. It is the first declaration the seed fold
 * reads, and both hosts load its views through `declarationPlugin`. A
 * feature's views are its family's declaration's, never core's: the outline's,
 * and the default view type it provides, are `@kb/outline`'s, and the
 * graph's, with its seed, are `@kb/graph`'s. Core's own are those that make
 * no family necessary: the home, where the page stands, and the read view
 * a node opens in where the default view type is not loaded (`NodeReadView`).
 */
import { CORE_CONTEXT_REFERENCES, defineExtension, viewDef } from "@kb/contracts";
import { DESIGN_SYSTEM_OPTIONS, SYSTEM_IDS, systemSeedNodes, type SeedOption } from "@kb/model";
import {
  DocsMarkdownView,
  ExtensionsView,
  HomeView,
  LayoutView,
  NodeReadView,
  NodeView,
  OntologyListView,
  OntologyScopeView,
  SettingsView,
} from "@kb/views";

/**
 * Core's design system (DESIGN-UI.md → Design tokens → Design systems):
 * layer 1 itself, under its own id. Core's key has no family part, as it
 * is contributed in the root namespace.
 */
export const KB_DESIGN_SYSTEM: SeedOption = { id: "kb", label: "kb" };

export const coreExtension = defineExtension({
  name: "core",
  label: "Core",
  tags: ["core"],
  seed: systemSeedNodes,
  views: [
    viewDef(OntologyListView),
    viewDef(OntologyScopeView),
    viewDef(DocsMarkdownView),
    viewDef(LayoutView),
    viewDef(NodeView),
    viewDef(ExtensionsView),
    viewDef(SettingsView),
    viewDef(HomeView),
    viewDef(NodeReadView),
  ],
  declaredOptions: [{ kind: DESIGN_SYSTEM_OPTIONS, options: [KB_DESIGN_SYSTEM] }],
  // ⌘K's Preferences became Settings with the page that replaced the popover.
  retires: [{ from: "sys.cmd.preferences", to: SYSTEM_IDS.cmdSettings, text: "Preferences" }],
  context: CORE_CONTEXT_REFERENCES,
});
