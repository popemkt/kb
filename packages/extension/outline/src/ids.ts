/**
 * The outline family's frozen ids: the fields it seeds. Each is the editor's
 * own data, so it exists exactly while the family is composed.
 */
export const OUTLINE_IDS = {
  /**
   * Whether a node's preview is open under its row (checkbox, one, hidden):
   * the node's own toggle; absent, its view's `previews open` setting
   * decides (`previewShownOf`, `@kb/outline-ui`).
   */
  previewField: "sys.f.outline.preview",
} as const;
