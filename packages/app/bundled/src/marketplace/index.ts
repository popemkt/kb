/**
 * The marketplaces kb's build carries, the lowest selection layer under the
 * three scopes (DESIGN.md → kb ships its own marketplace). Each is pinned as
 * an added one is; `bin/refresh-kb-marketplace` writes the pin and the bytes,
 * and the index is loaded only when a listing or install reads it, so a
 * command that never asks loads none of it.
 */
import type { BundledMarketplace } from "@kb/contracts";
import { KB_MARKETPLACE_NAME, KB_MARKETPLACE_SELECTION } from "./kb.pin.ts";

export const BUNDLED_MARKETPLACES: readonly BundledMarketplace[] = [
  {
    name: KB_MARKETPLACE_NAME,
    selection: KB_MARKETPLACE_SELECTION,
    index: () => import("./kb.index.ts").then(({ KB_MARKETPLACE_INDEX }) => KB_MARKETPLACE_INDEX),
  },
];
