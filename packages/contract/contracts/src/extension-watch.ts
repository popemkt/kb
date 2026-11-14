/**
 * Whether a `kb ui` server watches the root's own extensions, as the store
 * says (DESIGN.md → Watching the root's own extensions): core's setting
 * `sys.f.extensions.watch`, a checkbox on core's node, off where it says
 * nothing. `kb ui --watch-extensions` turns watching on for one run beside
 * it; this reads only the store's half.
 */
import { Schema } from "effect";
import {
  SYSTEM_IDS,
  decodeNodeConfig,
  extensionNodeId,
  firstBool,
  oneOf,
  writeBool,
  type ConfigSlots,
} from "@kb/model";
import type { NodeLookup } from "./extension-switch.ts";

const WATCH = SYSTEM_IDS.extensionsWatchField;

/** The node that holds the setting: core's, since the server is core's. */
export const EXTENSIONS_WATCH_NODE = extensionNodeId("core");

const watchSlots: ConfigSlots<{ watch: boolean }> = {
  watch: oneOf({
    fields: [WATCH],
    read: firstBool(WATCH),
    write: writeBool(WATCH),
    schema: Schema.Boolean,
    fallback: false,
  }),
};

/**
 * Whether the store `nodeOf` reads has the server watch the root's own
 * extensions. A value that does not read as a checkbox reads as off, and
 * `report` hears why.
 */
export function extensionsWatched(nodeOf: NodeLookup, report: (warning: string) => void): boolean {
  return decodeNodeConfig(watchSlots, nodeOf(EXTENSIONS_WATCH_NODE)?.props, report)("watch");
}
