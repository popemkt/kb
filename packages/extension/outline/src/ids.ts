/**
 * The outline family's frozen ids: the fields it seeds. Each is the editor's
 * own data, so it exists exactly while the family is composed.
 */
import type { DisplayOption, NodeId } from "@kb/model";

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
} as const;
