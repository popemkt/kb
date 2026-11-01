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
} as const;
