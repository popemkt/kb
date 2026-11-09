import type { PointDefinition } from "@kb/contracts";

/** Shared metadata consumed by the family's page point owner. */
export const LAB_POINT_DEFINITIONS = {
  studies: {
    declared: true,
    name: "lab.studies",
    spec: {
      cardinality: "keyed",
      combine: "lookup by scene",
      kernel: "page",
      tier: "T3",
      keyBy: "scene",
    },
  },
} as const satisfies Readonly<Record<string, PointDefinition>>;
