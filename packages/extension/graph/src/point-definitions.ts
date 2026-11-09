import type { PointDefinition } from "@kb/contracts";

/** Shared metadata consumed by the family's page point owner. */
export const GRAPH_POINT_DEFINITIONS = {
  themes: {
    name: "graph.themes",
    spec: {
      cardinality: "keyed",
      combine: "lookup by contribution id",
      kernel: "page",
      tier: "T3",
    },
  },
} as const satisfies Readonly<Record<string, PointDefinition>>;
