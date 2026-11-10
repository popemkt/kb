import type { PointDefinition } from "@kb/contracts";

/**
 * The points the days family declares (DESIGN.md → Days): the day page's
 * sections, which any plugin fills, so days never imports the families
 * that show something on a day.
 */
export const DAYS_POINT_DEFINITIONS = {
  sections: {
    declared: true,
    name: "days.sections",
    spec: {
      cardinality: "list",
      combine: "ascending order",
      kernel: "page",
      tier: "T3",
    },
  },
} as const satisfies Readonly<Record<string, PointDefinition>>;
