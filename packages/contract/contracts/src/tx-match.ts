import { Predicate, type Effect } from "effect";
import { canonicalJson } from "@kb/model";
import type { TxChange, ReactionHost } from "./reactions.ts";
import { z } from "zod";

const Ids = z.array(z.string().min(1)).readonly();

/** Data matched by the host before calling a transaction listener. */
export const TxMatchSchema = z
  .strictObject({
    tagged: Ids.optional(),
    untagged: Ids.optional(),
    fields: Ids.optional(),
    created: z.boolean().optional(),
    deleted: z.boolean().optional(),
  })
  .readonly();
export type TxMatch = z.infer<typeof TxMatchSchema>;

/** The same conditions the matcher reads, rendered without running extension code. */
export function describeTxMatch(match: TxMatch): string {
  if (Object.keys(match).length === 0) return "any local node write";
  const conditions = [
    ...(match.tagged ?? []).map((tag) => `tagged ${tag}`),
    ...(match.untagged ?? []).map((tag) => `untagged ${tag}`),
    ...(match.fields ?? []).map((field) => `field ${field} changes`),
    ...(match.created === true ? ["node created"] : []),
    ...(match.deleted === true ? ["node deleted"] : []),
  ];
  return conditions.length === 0 ? "no changes" : conditions.join(" or ");
}

/** Decoding freezes the stored match, so it cannot broaden after admission. */
export const TxReactionSchema = z
  .strictObject({
    match: TxMatchSchema,
    react: z.custom<(change: TxChange, kb: ReactionHost) => Effect.Effect<void>>(
      Predicate.isFunction,
    ),
  })
  .readonly();
export type TxReaction = z.infer<typeof TxReactionSchema>;

/** A host constraint on the same contribution contract, applied to every descendant. */
export function approvedReactions(matches: readonly TxMatch[]) {
  const allowed = new Set(matches.map(canonicalJson));
  return TxReactionSchema.refine(({ match }) => allowed.has(canonicalJson(match)), {
    message: "reaction match is not declared in the manifest's reacts",
  });
}
