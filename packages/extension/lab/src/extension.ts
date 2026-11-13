import { LAB_POINT_DEFINITIONS } from "./point-definitions.ts";
/**
 * The lab family's declaration and its shared plugin (DESIGN.md → Extension
 * families). The declaration is the one home of the family's name and
 * views; the bundled seed folds it, and both hosts load {@link labPlugin},
 * so the key cannot differ between them. The lab declares no system node:
 * its view's option under `sys.views` is derived from its key, and a lab
 * page says itself in the generic text, so its view carries no text of its
 * own. It is optional: the off-by-default sketchbook a person switches on.
 */
import { declarationPlugin, defineExtension, viewDef } from "@kb/contracts";
import type { Plugin } from "@kb/plugin";
import { LabView } from "./view.ts";

/** The family's pure colour-token declaration and SSR fallbacks. */
const LAB_COLOR_TOKENS = {
  "--lab-ground": "rgb(128, 128, 128)",
  "--lab-edge": "rgb(128, 128, 128)",
  "--lab-hue": "rgb(128, 128, 128)",
  "--lab-ink": "rgb(128, 128, 128)",
  "--lab-accent": "rgb(128, 128, 128)",
} as const;

export const labExtension = defineExtension({
  name: "lab",
  colorTokens: LAB_COLOR_TOKENS,
  label: "Lab",
  points: Object.values(LAB_POINT_DEFINITIONS),
  manifest: { description: "A sketchbook of experimental scenes, off until you switch it on." },
  tags: ["lab"],
  optional: { byDefault: "off" },
  views: [viewDef(LabView)],
});

/**
 * The lab family's shared plugin: its declaration's view. It is the server's
 * entry as it is, and the page's entry loads it as a child.
 */
export function labPlugin(): Plugin {
  return declarationPlugin(labExtension);
}
