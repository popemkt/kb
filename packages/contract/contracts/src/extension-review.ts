import { z } from "zod";
import { ExtensionScopeSchema, ExtensionSelectionSchema } from "./extension-install.ts";

export const ExtensionOriginSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("own") }),
  z.object({ kind: z.literal("link"), scope: ExtensionScopeSchema }),
  z.object({
    kind: z.literal("install"),
    scope: ExtensionScopeSchema,
    selection: ExtensionSelectionSchema,
  }),
]);
export type ExtensionOrigin = z.infer<typeof ExtensionOriginSchema>;
export const ExtensionReachSchema = z.object({
  files: z.array(z.object({ path: z.string(), bytes: z.number().int().nonnegative() })),
  page: z.boolean(),
  host: z.object({ server: z.array(z.string()), page: z.array(z.string()) }),
  builtins: z.array(z.string()),
});
export type ExtensionReach = z.infer<typeof ExtensionReachSchema>;
export const ExtensionReviewSchema = z.object({
  origin: ExtensionOriginSchema.optional(),
  files: z.string().optional(),
  trusted: z.boolean().optional(),
  shadowed: z.string().optional(),
  running: z.object({ digest: z.string(), source: z.string() }).optional(),
  reach: ExtensionReachSchema.optional(),
});
