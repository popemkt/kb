/**
 * The outline family's frozen ids: the fields it seeds. Each is the editor's
 * own data, so it exists exactly while the family is composed.
 */
import type { DisplayOption, NodeId, RefForm } from "@kb/model";
import type { ExportOptions, OutlineFormatId } from "@kb/outline-paste";

export const OUTLINE_IDS = {
  /**
   * A node's own answer to each display option its tag opening offers
   * (checkbox, one, hidden): on or off for this node; absent, its view's
   * family's setting decides (`displayShownOf`, `@kb/outline-ui`).
   */
  displayFields: {
    preview: "sys.f.outline.preview",
    properties: "sys.f.outline.properties",
  } satisfies Readonly<Record<DisplayOption, NodeId>>,
  /**
   * Whether a collapsed parent's bullet shows how many children it has: a
   * setting of the family's node, off when it says nothing
   * (`showsChildCounts`).
   */
  childCountsField: "sys.f.outline.child-counts",
  /**
   * Whether the outline hides the reference count at the right edge of rows.
   * The count is shown when this setting is unset (`showsReferenceCounts`).
   */
  hideReferenceCountsField: "sys.f.outline.hide-reference-counts",
  /**
   * "Add description" / "Edit description": the node command, on ⌘K, the
   * node menu and Mod-Shift-E, that opens the node's description for editing
   * where it is drawn (DESIGN-UI.md → Outline editor, "A node's description").
   */
  describeCommand: "sys.cmd.outline.describe",
  /** "Copy as…": the node command, on ⌘K, the node menu and Mod-Shift-C. */
  copyAsCommand: "sys.cmd.outline.copy-as",
  /**
   * The choice Copy as… opens on and writes, settings of the family's node:
   * the format, the references and the indent are fields whose options are
   * their children, and children and fields and tags are checkboxes. Unset,
   * each reads as `EXPORT_DEFAULTS` (`copyChoiceOf`).
   */
  copy: {
    formatField: "sys.f.outline.copy.format",
    refsField: "sys.f.outline.copy.refs",
    indentField: "sys.f.outline.copy.indent",
    childrenField: "sys.f.outline.copy.children",
    fieldsAndTagsField: "sys.f.outline.copy.fields-and-tags",
  },
} as const;

/** The option of the copy format field that is format `id`. */
export const copyFormatOption = (id: OutlineFormatId): NodeId => `sys.outline.copy.format.${id}`;

/** The option of the copy references field that is form `form`. */
export const copyRefsOption = (form: RefForm): NodeId => `sys.outline.copy.refs.${form}`;

/** The option of the copy indent field that is `indent`. */
export const copyIndentOption = (indent: ExportOptions["indent"]): NodeId =>
  `sys.outline.copy.indent.${indent}`;
