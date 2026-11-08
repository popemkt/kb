import { z } from "zod";
import { marketplaceName } from "@kb/extension-source";
import { ExtensionScopeSchema, ExtensionSelectionSchema } from "./extension-install.ts";

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
export const ExtensionReachSchema = z.object({
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
});
