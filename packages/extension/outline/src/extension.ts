/**
 * The outline family's declaration and its shared plugin (DESIGN.md →
 * Extension families). The outline is the default editing mode: its
 * declaration provides the default view type (`defaultView`), the view a
 * node opens in when it names none. It is optional and on by default:
 * switched off, or not bundled, a node that names no view is read in core's
 * read view (`NodeReadView`) instead, and the page's home is core's, so
 * nothing else needs the outline. The declaration is the one
 * home of the family's name and views; the bundled seed folds it, and both
 * hosts' entries are {@link outlinePlugin}: the server's directly, the page's
 * as a child of `@kb/outline-ui`'s entry.
 *
 * Its view keys are `@kb/views`' (`outline.ts`): every frame view's page is
 * the outline at its frame (`frameViewKey`), and the collection views are
 * another family's, which may not reach this package.
 */
import { declarationPlugin, defineExtension, viewDef } from "@kb/contracts";
import { seededField } from "@kb/model";
import type { Plugin } from "@kb/plugin";
import { OutlineListView, OutlineSnippetView, OutlineView } from "@kb/views";
import { OUTLINE_IDS } from "./ids.ts";

export const outlineExtension = defineExtension({
  name: "outline",
  label: "Outline",
  optional: { byDefault: "on" },
  tags: ["outline"],
  defaultView: OutlineView,
  views: [viewDef(OutlineView), viewDef(OutlineListView), viewDef(OutlineSnippetView)],
  // A node's own preview toggle: the editor's, never drawn as a field row.
  seed: (at) => [
    seededField(OUTLINE_IDS.previewField, "preview", "checkbox", at, { one: true, hidden: true }),
  ],
});

/** The outline family's shared plugin: its declaration's views, on either host. */
export function outlinePlugin(): Plugin {
  return declarationPlugin(outlineExtension);
}
