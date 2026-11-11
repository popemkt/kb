import { TxReactionSchema } from "./tx-match.ts";
/** Shared host point metadata, consumed by the keys in every host. */
import type { PointSpec } from "@kb/plugin";

export interface PointDefinition {
  readonly name: string;
  readonly spec: PointSpec;
  /** Resolved through ctx.point rather than an imported host key. */
  readonly declared?: true;
}

/** Native ownership is build policy, independent of point availability or switches. */
export const CORE_POINT_NAMESPACES = ["kb", "ui", "action", "tx", "identity"] as const;

export const CORE_POINT_DEFINITIONS = {
  paletteStep: {
    declared: true,
    name: "ui.palette-steps",
    spec: {
      cardinality: "keyed",
      combine: "lookup by contribution id",
      kernel: "page",
      tier: "T3",
    },
  },
  txAfter: {
    name: "tx/after",
    spec: {
      contract: TxReactionSchema,
      cardinality: "list",
      combine: "all, independently, after the committing invocation settles",
      kernel: "registry",
      tier: "T3",
    },
  },
  viewKey: {
    name: "kb.views",
    spec: {
      cardinality: "keyed",
      combine: "lookup by contribution id",
      kernel: ["registry", "server", "page"],
      tier: "T3",
    },
  },
  identity: {
    name: "identity.providers",
    spec: {
      cardinality: "chain",
      combine: "first non-null answer",
      kernel: "server",
      tier: "T3",
    },
  },
  actionGuard: {
    name: "action/guard",
    spec: {
      cardinality: "list",
      combine: "strictest verdict",
      kernel: ["registry", "page"],
      tier: "T3",
    },
  },
  actionInterceptor: {
    name: "action/intercept",
    spec: {
      cardinality: "chain",
      combine: "input in order, output in reverse",
      kernel: ["registry", "page"],
      tier: "T3",
    },
  },
  procedure: {
    name: "kb.procedures",
    spec: {
      cardinality: "keyed",
      combine: "lookup by contribution id",
      kernel: ["registry", "server"],
      tier: "T3",
    },
  },
  action: {
    name: "kb.actions",
    spec: {
      cardinality: "keyed",
      combine: "lookup by contribution id",
      kernel: ["registry", "server", "page"],
      tier: "T3",
    },
  },
  template: {
    name: "kb.templates",
    spec: {
      cardinality: "keyed",
      combine: "lookup by contribution id",
      kernel: "registry",
      tier: "T3",
    },
  },
  contextReference: {
    name: "kb.context",
    spec: {
      cardinality: "list",
      combine: "all in contribution order",
      kernel: ["registry", "server", "page"],
      tier: "T0",
    },
  },
  channel: {
    name: "kb.ui.channels",
    spec: {
      cardinality: "keyed",
      combine: "lookup by contribution id",
      kernel: "server",
      tier: "T3",
    },
  },
  keyContext: {
    name: "ui.key-contexts",
    spec: {
      cardinality: "keyed",
      combine:
        "one context per id, owned by the plugin that contributes it: the page's are offered every key first, so their chords are held in every context",
      kernel: ["registry", "page"],
      tier: "T0",
    },
  },
  keybinding: {
    name: "ui.keybindings",
    spec: {
      cardinality: "keyed",
      combine:
        "one binding per chord per context: the context owner's first, then load order; an overlapping or reserved chord is refused unless the binding replaces its holder",
      kernel: ["registry", "page"],
      tier: "T0",
    },
  },
  valueKind: {
    name: "ui.value-kinds",
    spec: {
      cardinality: "keyed",
      combine: "lookup by field-type option",
      kernel: "page",
      tier: "T3",
      keyBy: "type",
    },
  },
  command: {
    name: "ui.commands",
    spec: {
      cardinality: "list",
      combine: "node menu: by group, then order, then contribution order; ⌘K: by sys.command node",
      kernel: "page",
      tier: "T3",
    },
  },
  actionReview: {
    name: "ui.action-reviews",
    spec: {
      cardinality: "list",
      combine: "all in contribution order",
      kernel: "page",
      tier: "T3",
    },
  },
  optionPreview: {
    name: "ui.option-previews",
    spec: {
      cardinality: "keyed",
      combine: "lookup by option field",
      kernel: "page",
      tier: "T3",
      keyBy: "kind.field",
    },
  },
  view: {
    name: "ui.views",
    spec: {
      cardinality: "keyed",
      combine: "lookup by contribution id",
      kernel: "page",
      tier: "T3",
    },
  },
  route: {
    name: "ui.routes",
    spec: {
      cardinality: "chain",
      combine: "first matching route",
      kernel: "page",
      tier: "T3",
    },
  },
  sidebarSection: {
    name: "ui.sidebar",
    spec: {
      cardinality: "list",
      combine: "ascending order",
      kernel: "page",
      tier: "T3",
    },
  },
  nodeSection: {
    name: "ui.node-sections",
    spec: {
      cardinality: "list",
      combine: "those for a tag the node is, through what it extends, in ascending order",
      kernel: "page",
      tier: "T3",
    },
  },
  dock: {
    name: "ui.docks",
    spec: {
      cardinality: "keyed",
      combine: "lookup by contribution id",
      kernel: "page",
      tier: "T3",
    },
  },
  overlay: {
    name: "ui.overlays",
    spec: {
      cardinality: "list",
      combine: "mount all",
      kernel: "page",
      tier: "T3",
    },
  },
  backdrop: {
    name: "ui.backdrops",
    spec: {
      cardinality: "keyed",
      combine: "lookup by contribution id",
      kernel: "page",
      tier: "T3",
    },
  },
  backdropAction: {
    name: "ui.backdrop-actions",
    spec: {
      cardinality: "keyed",
      combine: "lookup by contribution id",
      kernel: "page",
      tier: "T3",
    },
  },
  designSystem: {
    name: "ui.design-systems",
    spec: {
      cardinality: "keyed",
      combine: "lookup by contribution id",
      kernel: "page",
      tier: "T3",
    },
  },
} as const satisfies Readonly<Record<string, PointDefinition>>;
