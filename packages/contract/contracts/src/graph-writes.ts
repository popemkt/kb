import { Context, type Effect } from "effect";
import { z } from "zod";
import type { DomainError, KbNode, NodeId, StoreTx } from "@kb/model";

/** What a plan writes: the nodes to put and the ids to delete, and whatever else its planner answers. */
export interface GraphWrite {
  readonly upserts: readonly KbNode[];
  readonly deletes: readonly NodeId[];
}

/**
 * A write as a family plans it: the transaction to make over the graph as it
 * is (`nodes`), null for none, or a refusal (`E`, a `DomainError` unless the
 * family refuses in its own words). It may read the services `R` its action
 * runs with, the session among them, which has caught up to `nodes`.
 */
export type GraphPlan<W extends GraphWrite = StoreTx, E = DomainError, R = never> = (
  nodes: readonly KbNode[],
) => Effect.Effect<W | null, E, R>;

/**
 * Core's write path, as a port a family's action writes through. It is the
 * path every core action commits by, not a second one: `commit(plan)` plans
 * the write over the session's graph as it has caught up, and lands it only
 * on that state, planning it again when another process wrote in between,
 * so a node rewritten from what was read never loses a concurrent write
 * (`persistPlannedEffect`). The commit checks the transaction's integrity,
 * asks the approval resolver again with what it writes when it runs inside
 * an invocation, records it with the call's origin, and moves the session's
 * index and transaction log with it. It answers the write it committed, as
 * the plan answered it, or null when the plan had nothing to write, and
 * fails with the `DomainError` `persistEffect` fails with, or the plan's
 * refusal, as the plan refused.
 */
export interface GraphWritesPort {
  readonly commit: <W extends GraphWrite, E = DomainError, R = never>(
    plan: GraphPlan<W, E, R>,
  ) => Effect.Effect<W | null, DomainError | E, R>;
}

export class GraphWrites extends Context.Service<GraphWrites, GraphWritesPort>()(
  "kb/GraphWrites",
) {}

/** One value a node write sets: a field, by name or id, and the value it gains. */
export const PropInputSchema = z.object({
  field: z.string(),
  value: z.union([
    z.object({ t: z.literal("str"), v: z.string() }),
    z.object({ t: z.literal("num"), v: z.number() }),
    z.object({ t: z.literal("bool"), v: z.boolean() }),
    z.object({ t: z.literal("ref"), v: z.string() }),
  ]),
});

/**
 * A write's leave to define each field it names that does not exist yet,
 * as `field.define` defines one, in the write's own transaction: a write
 * that fails leaves no field behind (`kb add --create`).
 */
export const CreateFieldsSchema = z
  .boolean()
  .optional()
  .describe(
    "define each field the write names that does not exist yet, as field.define does, in the same transaction",
  );

/**
 * `node.update`'s input: what one edit of a node says. It is a contract so
 * that whatever reads an update before it runs (days' untag interceptor)
 * reads it exactly as the action will.
 */
export const NodeUpdateInputSchema = z.object({
  id: z.string(),
  text: z.string().optional(),
  /** Refuse the entire update if this is no longer the node’s text. */
  expectedText: z.string().optional(),
  setProps: z.array(PropInputSchema).optional(),
  /** Require these fields (by name or id) to hold no values before this edit. */
  requireUnset: z.array(z.string()).optional(),
  /** Require these fields (by name or id) to hold a value before this edit. */
  requireSet: z.array(z.string()).optional(),
  unsetProps: z.array(z.object({ field: z.string(), value: z.unknown().optional() })).optional(),
  /** Move under this parent, or to the forest roots when null. */
  parent: z.string().nullable().optional(),
  /** Index in the target sibling group; the end when omitted on a move. */
  position: z.number().int().nonnegative().optional(),
  createFields: CreateFieldsSchema,
  /** Bypass sys.* write-guard (browse yes / break no). */
  force: z.boolean().optional(),
});
