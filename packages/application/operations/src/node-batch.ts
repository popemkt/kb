/**
 * `node.batch`: several `node.add` / `node.update` / `node.delete` calls as
 * one transaction (DESIGN.md → Batches of writes). Each call is planned by
 * its action's own planner over one working copy of the nodes, the copy
 * taking each call's writes before the next is planned, and the whole is
 * committed once.
 */
import { Effect, Predicate } from "effect";
import { z } from "zod";
import { type ActionDefinition, KbCtx, type KbStore, NodeUpdateInputSchema } from "@kb/contracts";
import {
  currentIso,
  domainError,
  freshId,
  IndexedNodes,
  planNodeAdd,
  syncDomain,
  type DomainError,
  type KbNode,
  type NodeId,
} from "@kb/model";
import {
  forcedBy,
  nodeAddDef,
  nodeDeleteDef,
  nodeUpdateDef,
  planNodeDelete,
  planNodeUpdate,
  type PlannedNodeWrite,
} from "./actions.ts";
import { persistPlannedEffect } from "./session.ts";

/**
 * One call of a batch: a part's own input, read by its own schema, less
 * `force`, which the batch states once. An add names its parent, since a
 * batch decides every place itself.
 */
const BatchCallSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("node.add"),
    input: nodeAddDef.inputSchema.omit({ force: true }).extend({
      parent: z.string().nullable().describe("the node it goes under; null for the top level"),
    }),
  }),
  z.object({
    action: z.literal("node.update"),
    input: NodeUpdateInputSchema.omit({ force: true }),
  }),
  z.object({
    action: z.literal("node.delete"),
    input: nodeDeleteDef.inputSchema.omit({ force: true }),
  }),
]);

type BatchCall = z.infer<typeof BatchCallSchema>;

export const nodeBatchDef = {
  id: "node.batch",
  title: "Batch node writes",
  description:
    "Run several node.add / node.update / node.delete calls as one transaction: each call " +
    "is {action, input} with that action's own input (less force); each is planned over " +
    "what the calls before it wrote, so a later call sees an earlier one. A node.add names " +
    "its parent (null for the top level). All or nothing; returns each call's node id in order.",
  mode: { kind: "write" } as const,
  // Every call is a batch of these: a guard on any of them governs it too,
  // by that part's own mode.
  batchOf: [nodeAddDef.id, nodeUpdateDef.id, nodeDeleteDef.id],
  inputSchema: z.object({
    calls: z.array(BatchCallSchema).min(1),
    /** Bypass sys.* write-guard (browse yes / break no), for the whole commit. */
    force: z.boolean().optional(),
  }),
  outputSchema: z.object({
    /** Each call's node, in call order: the node added, updated or deleted. */
    ids: z.array(z.string()),
  }),
} satisfies ActionDefinition;

type NodeBatchInput = z.infer<typeof nodeBatchDef.inputSchema>;

/** Prefix a failure with the call it belongs to. */
const atCall =
  (index: number) =>
  (err: DomainError): DomainError =>
    domainError(err.code, `call ${index}: ${err.message}`, {
      call: index,
      ...(Predicate.isObject(err.details) ? err.details : {}),
    });

/** The nodes `write` leaves of `nodes`: its upserts put, its deletes gone. */
function applied(nodes: readonly KbNode[], write: PlannedNodeWrite): KbNode[] {
  const put = new Map(write.upserts.map((node) => [node.id, node]));
  const gone = new Set(write.deletes);
  const kept = nodes.flatMap((node) => {
    if (gone.has(node.id)) return [];
    const next = put.get(node.id);
    put.delete(node.id);
    return [next ?? node];
  });
  return [...kept, ...put.values()];
}

/** One call planned over `nodes`, by its action's own planner: its node, and what it writes. */
const planCall = Effect.fn("node.batch.call")(function* (
  nodes: KbNode[],
  call: BatchCall,
  at: string,
): Effect.fn.Return<{ id: NodeId; write: PlannedNodeWrite }, DomainError> {
  if (call.action === "node.add") {
    const id = call.input.id ?? (yield* freshId);
    const graph = IndexedNodes.of(nodes);
    const { written } = yield* syncDomain(() =>
      planNodeAdd(graph, { ...call.input, parent: call.input.parent ?? undefined }, id, at),
    );
    const upserts = written.flatMap((w) => graph.get(w) ?? []);
    return { id, write: { upserts, deletes: [] } };
  }
  if (call.action === "node.update") {
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const { write } = yield* planNodeUpdate(nodes, call.input, at, (id) => byId.get(id));
    return { id: call.input.id, write };
  }
  // A node already gone is deleted already: nothing to write, as `node.delete`.
  return { id: call.input.id, write: planNodeDelete(nodes, call.input, at) };
});

/**
 * The plan of `node.batch` over `nodes`, checked but not stored: each call
 * planned in order over the nodes the calls before it left (`applied`), and
 * the transaction that takes `nodes` to the last of them.
 */
const planNodeBatch = Effect.fn("node.batch.plan")(function* (
  input: NodeBatchInput,
  nodes: readonly KbNode[],
): Effect.fn.Return<{ ids: NodeId[]; upserts: KbNode[]; deletes: NodeId[] }, DomainError> {
  const at = yield* currentIso;
  let working: KbNode[] = [...nodes];
  const ids: NodeId[] = [];
  const touched = new Set<NodeId>();
  for (const [index, call] of input.calls.entries()) {
    const { id, write } = yield* planCall(working, call, at).pipe(Effect.mapError(atCall(index)));
    ids.push(id);
    for (const node of write.upserts) touched.add(node.id);
    for (const gone of write.deletes) touched.add(gone);
    working = applied(working, write);
  }
  const after = new Map(working.map((node) => [node.id, node]));
  const before = new Set(nodes.map((node) => node.id));
  const upserts = [...touched].flatMap((id) => after.get(id) ?? []);
  const deletes = [...touched].filter((id) => !after.has(id) && before.has(id));
  return { ids, upserts, deletes };
});

/**
 * `node.batch`: its plan over the session's stored nodes, committed once on
 * the state it was planned from (`persistPlannedEffect`): one integrity
 * check, one approval and guard decision, one transaction-log entry, one
 * undo step. Any failure, in any call, writes nothing.
 */
export const nodeBatchEffect = Effect.fn("node.batch")(function* (
  input: NodeBatchInput,
): Effect.fn.Return<z.infer<typeof nodeBatchDef.outputSchema>, DomainError, KbCtx | KbStore> {
  const ctx = yield* KbCtx;
  const planned = yield* persistPlannedEffect(
    ctx,
    (nodes) => planNodeBatch(input, nodes),
    forcedBy(input),
  );
  return { ids: planned?.ids ?? [] };
});
