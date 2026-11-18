import {
  VIEW_FAMILY_OPTIONS,
  DISPLAY_OPTIONS,
  SYSTEM_IDS,
  extensionNodeId,
  seededCommand,
  seededField,
  type KbNode,
} from "@kb/model";
import { OUTLINE_FORMATS } from "@kb/outline-paste";
import { OUTLINE_KEYBOARD } from "./keyboard.ts";
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
import { declarationPlugin, defineExtension, viewDef, FIELD_EDITOR_ROLE } from "@kb/contracts";

import type { Plugin } from "@kb/plugin";
import { OutlineListView, OutlineSnippetView, OutlineView } from "@kb/views";
import { copyFormatOption, copyIndentOption, copyRefsOption, OUTLINE_IDS } from "./ids.ts";
import { OUTLINE_POINT_DEFINITIONS } from "./point-definitions.ts";

/** A setting of the family's own node: written like any field. */
const CONFIGURES_OUTLINE: KbNode["props"] = {
  [SYSTEM_IDS.configuresField]: [{ t: "ref", v: extensionNodeId("outline") }],
};

const optionNode = (id: string, text: string, at: string): KbNode => ({
  id,
  text,
  props: {},
  children: [],
  createdAt: at,
  updatedAt: at,
});

/** A copy setting whose options are its children, `options` in order. */
function choiceField(id: string, text: string, options: readonly [string, string][], at: string) {
  return [
    {
      ...seededField(id, text, "ref", at, { one: true, props: CONFIGURES_OUTLINE }),
      children: options.map(([optionId]) => optionId),
    },
    ...options.map(([optionId, label]) => optionNode(optionId, label, at)),
  ];
}

/**
 * Copy as…'s command and the choice it remembers (DESIGN-UI.md → Outline
 * editor, "Copy, cut and Copy as…"). The format's options are the formats
 * (`OUTLINE_FORMATS`), so no list of them is kept twice.
 */
function copySeed(at: string): KbNode[] {
  const { copy } = OUTLINE_IDS;
  return [
    seededCommand(OUTLINE_IDS.copyAsCommand, "Copy as…", at),
    ...choiceField(
      copy.formatField,
      "copy format",
      OUTLINE_FORMATS.map((format) => [copyFormatOption(format.id), format.label]),
      at,
    ),
    ...choiceField(
      copy.refsField,
      "copy references as",
      [
        [copyRefsOption("label"), "words"],
        [copyRefsOption("link"), "[[links]]"],
        [copyRefsOption("id"), "ids"],
      ],
      at,
    ),
    ...choiceField(
      copy.indentField,
      "copy indent",
      [
        [copyIndentOption("spaces"), "two spaces"],
        [copyIndentOption("tabs"), "a tab"],
      ],
      at,
    ),
    seededField(copy.childrenField, "copy children", "checkbox", at, {
      one: true,
      props: CONFIGURES_OUTLINE,
    }),
    seededField(copy.fieldsAndTagsField, "copy fields and tags", "checkbox", at, {
      one: true,
      props: CONFIGURES_OUTLINE,
    }),
  ];
}

export const outlineExtension = defineExtension({
  name: "outline",
  keyboard: OUTLINE_KEYBOARD,
  label: "Outline",
  manifest: {
    description: "The outliner: the default way to read and edit a node and its children.",
  },
  optional: { byDefault: "on" },
  tags: ["outline"],
  roles: [FIELD_EDITOR_ROLE],
  defaultView: OutlineView,
  familyDefaultViews: { [OutlineListView.family]: OutlineListView },
  declaredOptions: [
    {
      kind: VIEW_FAMILY_OPTIONS,
      options: [{ id: "outline.frame", order: 2, label: "Frame view" }],
    },
  ],
  views: [viewDef(OutlineView), viewDef(OutlineListView), viewDef(OutlineSnippetView)],
  points: Object.values(OUTLINE_POINT_DEFINITIONS),
  seed: (at) => [
    // A node's own display toggles: the editor's, never drawn as field rows.
    ...DISPLAY_OPTIONS.map((option) =>
      seededField(OUTLINE_IDS.displayFields[option], `shows ${option}`, "checkbox", at, {
        one: true,
        show: "never",
      }),
    ),
    // A setting of the family's own node: written like any field, read where a row draws its bullet.
    seededField(OUTLINE_IDS.childCountsField, "show child counts", "checkbox", at, {
      one: true,
      props: CONFIGURES_OUTLINE,
    }),
    ...copySeed(at),
  ],
});

/** The outline family's shared plugin: its declaration's views, on either host. */
export function outlinePlugin(): Plugin {
  return declarationPlugin(outlineExtension);
}
