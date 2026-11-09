import type { PluginAuthority } from "@kb/plugin";
import type { ExtensionManifest } from "./extension-manifest.ts";
import { TxAfterPoint } from "./reactions.ts";
import { approvedReactions } from "./tx-match.ts";

/** Translate the host's manifest data once, for bundled and installed roots alike. */
export function manifestAuthority(
  manifest: ExtensionManifest | undefined,
): Pick<PluginAuthority, "uses" | "pointContracts" | "replacements"> {
  return {
    replacements: (manifest?.replaces ?? []).map(({ role, priority }) => ({
      role,
      ...(priority === undefined ? {} : { priority }),
    })),
    ...(manifest?.uses === undefined ? {} : { uses: manifest.uses }),
    ...(manifest?.reacts === undefined
      ? {}
      : {
          pointContracts: [{ point: TxAfterPoint, contract: approvedReactions(manifest.reacts) }],
        }),
  };
}
