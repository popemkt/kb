import { z } from "zod";
import { FOOTPRINT_SOURCES } from "./footprint.ts";

const SeedKindSchema = z.enum(["view", "backdrop", "design system", "other"]);

export const SeedReferenceSchema = z.object({
  node: z.string(),
  target: z.string(),
  kind: SeedKindSchema,
});

const PluginImpactSchema = z.object({
  plugin: z.string(),
  source: z.enum(FOOTPRINT_SOURCES).exclude(["seed"]),
  keys: z.array(z.string()),
});

const ReferenceGroupSchema = z.object({ kind: SeedKindSchema, count: z.number().int().positive() });

export const ExtensionImpactSchema = z.object({
  name: z.string(),
  on: z.boolean(),
  blockedBy: z.array(z.string()),
  pauses: z.array(PluginImpactSchema),
  degrades: z.array(ReferenceGroupSchema),
  resumes: z.array(PluginImpactSchema),
  restores: z.array(ReferenceGroupSchema),
  unresolved: z.array(PluginImpactSchema),
});

export type ExtensionImpact = z.infer<typeof ExtensionImpactSchema>;
export type SeedReference = z.infer<typeof SeedReferenceSchema>;
