import type { PointDefinition } from "@kb/contracts";

/** Shared metadata consumed by the family's page point owner. */
export const GALLERY_POINT_DEFINITIONS = {
  model: {
    name: "gallery.model",
    spec: {
      cardinality: "keyed",
      combine: "lookup by contribution id",
      kernel: "page",
      tier: "T3",
    },
  },
  moodboard: {
    name: "gallery.moodboard",
    spec: {
      cardinality: "keyed",
      combine: "lookup by contribution id",
      kernel: "page",
      tier: "T3",
    },
  },
} as const satisfies Readonly<Record<string, PointDefinition>>;
