import { z } from "zod";
import { marketplaceName } from "@kb/extension-source";
import { ExtensionScopeSchema, ExtensionSelectionSchema } from "./extension-install.ts";
import { ExtensionManifestSchema } from "./extension-manifest.ts";

/**
 * How a family came to be composed: kb's build, the `kb ui` host, the
 * store's own `.kb/extensions/`, a linked folder, or an install (which a
 * marketplace may have resolved: `installMarketplace`).
 */
export const ExtensionOriginSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("bundled") }),
  z.object({ kind: z.literal("host") }),
  z.object({ kind: z.literal("own") }),
  z.object({ kind: z.literal("link"), scope: ExtensionScopeSchema }),
  z.object({
    kind: z.literal("install"),
    scope: ExtensionScopeSchema,
    selection: ExtensionSelectionSchema,
  }),
]);
export type ExtensionOrigin = z.infer<typeof ExtensionOriginSchema>;

/**
 * Whether an origin is kb's own: its build (`bundled`) or the `kb ui` host
 * (`host`), as against one a repository added (its own folder, a link, an
 * install). Every reader that tells the two apart asks this.
 */
export function isKbOrigin(origin: ExtensionOrigin): boolean {
  return origin.kind === "bundled" || origin.kind === "host";
}

/**
 * Whether code of an origin may take a held key by naming what it
 * replaces, with no person approving that replacement: kb's own (its build,
 * the `kb ui` host) and the repository's own folder, whose bytes the
 * repository holds and reviews as it reviews any code. A linked or
 * installed extension's replacement waits for a person to approve it:
 * GAP [[01M6YFRJGV8MAF2AM34N567MBQ]].
 */
export function replacesWithoutApproval(origin: ExtensionOrigin): boolean {
  return isKbOrigin(origin) || origin.kind === "own";
}

/**
 * The marketplace an install was resolved through, or undefined for a
 * GitHub source: read from the selection's recorded request
 * (`name@marketplace`), the one place install writes it.
 */
export function installMarketplace(origin: ExtensionOrigin): string | undefined {
  if (origin.kind !== "install") return undefined;
  const { original } = origin.selection;
  if (original.startsWith("github:") || original.startsWith("https://github.com/"))
    return undefined;
  try {
    return marketplaceName(original).marketplace;
  } catch {
    return undefined;
  }
}
const ExtensionReachSchema = z.object({
  files: z.array(z.object({ path: z.string(), bytes: z.number().int().nonnegative() })),
  page: z.boolean(),
  host: z.object({ server: z.array(z.string()), page: z.array(z.string()) }),
  builtins: z.array(z.string()),
});
export type ExtensionReach = z.infer<typeof ExtensionReachSchema>;
export const ExtensionReviewSchema = z.object({
  files: z.string().optional(),
  trusted: z.boolean().optional(),
  shadowed: z.string().optional(),
  running: z.object({ digest: z.string(), source: z.string() }).optional(),
  reach: ExtensionReachSchema.optional(),
  /** What it says about itself: a repository extension's manifest file, a bundled family's declaration. */
  manifest: ExtensionManifestSchema.optional(),
});
