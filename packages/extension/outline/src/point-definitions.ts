import type { PointDefinition } from "@kb/contracts";

/**
 * The points the outline family declares (DESIGN-UI.md → Paste and drop):
 * a row's paste and drop handlers, a chain any plugin adds to, so the
 * outline never imports the families whose pastes it takes.
 */
export const OUTLINE_POINT_DEFINITIONS = {
  ingest: {
    declared: true,
    name: "outline.ingest",
    spec: {
      cardinality: "chain",
      combine: "first match by priority claims",
      kernel: "page",
      tier: "T3",
    },
  },
} as const satisfies Readonly<Record<string, PointDefinition>>;
