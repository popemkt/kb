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
import {
  CAPTURE_TARGET_ROLE,
  LANDING_ROLE,
  DATE_TARGET_ROLE,
  CORE_CONTEXT_REFERENCES,
  defineExtension,
  viewDef,
} from "@kb/contracts";
import { DESIGN_SYSTEM_OPTIONS } from "@kb/appearance";
import { SYSTEM_IDS, extensionNodeId, type SeedOption } from "@kb/model";
import { systemSeedNodes } from "@kb/seed";
import {
  DocsMarkdownView,
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
  manifest: {
    description: "The graph itself: nodes, fields, tags, search, views and these settings.",
  },
  tags: ["core"],
  required: "Everything else is built on it; without it there is no graph to extend.",
  seed: systemSeedNodes,
  views: [
    viewDef(OntologyListView),
    viewDef(OntologyScopeView),
    viewDef(DocsMarkdownView),
    viewDef(LayoutView),
    viewDef(NodeView),
    viewDef(SettingsView),
    viewDef(HomeView),
    viewDef(NodeReadView),
  ],
  declaredOptions: [{ kind: DESIGN_SYSTEM_OPTIONS, options: [KB_DESIGN_SYSTEM] }],
  // Its own lists it files under its node: the families' migration records.
  files: { [extensionNodeId("core")]: [SYSTEM_IDS.migrationsList] },
  // Where a node made with no chosen place goes, and where a page that
  // loads at the root opens: core's page half answers the top level and
  // home, and a family may replace either (days answers today). Where a
  // followed date leads: core's leads nowhere, and days answers its day.
  roles: [CAPTURE_TARGET_ROLE, LANDING_ROLE, DATE_TARGET_ROLE],
  retires: [
    // ⌘K's Preferences became Settings with the page that replaced the popover.
    { from: "sys.cmd.preferences", to: SYSTEM_IDS.cmdSettings, text: "Preferences" },
    // The Extensions page became Settings' Extensions part, and its command followed.
    { from: "sys.view.extensions.list", to: SettingsView.option },
    { from: SYSTEM_IDS.cmdExtensions, to: SYSTEM_IDS.cmdExtensions, text: "Extensions" },
    // ⌘K's "Add tag" makes a new tag; the node menu's adds one to a node.
    { from: SYSTEM_IDS.cmdAddTag, to: SYSTEM_IDS.cmdAddTag, text: "Add tag" },
  ],
  context: CORE_CONTEXT_REFERENCES,
});
