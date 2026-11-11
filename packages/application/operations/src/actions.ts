import { Effect, Schema } from "effect";
import { z } from "zod";
import {
  type ActionDefinition,
  type CaptureTarget,
  type CapturePlan,
  type KbContext,
  KbCtx,
  type KbStore,
  SavedQueries,
  viaWithin,
} from "@kb/contracts";
import {
  ResolveError,
  ActorSchema,
  SYSTEM_IDS,
  currentIso,
  domainError,
  domainFromResolve,
  freshId,
  rankForInsert,
  type RankSlot,
  IndexedNodes,
  resolveFieldId,
  resolveTagId,
  resolveTagIn,
  type NodeGraph,
  type SiblingGroups,
  type DomainError,
  type KbNode,
  type NodeId,
  type PropValue,
  present,
} from "@kb/model";
import { persistEffect, persistPlannedEffect, type PersistOptions } from "./session.ts";
import { placedGraph, placeOf } from "./place.ts";
import { applyProps, projectPropEdits, type PropEntry } from "./prop-edits.ts";
import { DatalogError, QueryEngineService, type NodeIndex } from "@kb/query";

type KbWriteEnv = KbCtx | KbStore;
/** A write that may place a node where captures go. */
type KbCaptureEnv = KbWriteEnv | CaptureTarget;

/** Lift sync resolve/throw helpers into DomainError. */
export function syncDomain<A>(f: () => A): Effect.Effect<A, DomainError> {
  return Effect.try({
    try: f,
    catch: (err) => {
      if (err instanceof ResolveError) return domainFromResolve(err);
      return domainError("internal", err instanceof Error ? err.message : String(err));
    },
  });
}

const PropInputSchema = z.object({
  field: z.string(),
  value: z.union([
    z.object({ t: z.literal("str"), v: z.string() }),
    z.object({ t: z.literal("num"), v: z.number() }),
    z.object({ t: z.literal("bool"), v: z.boolean() }),
    z.object({ t: z.literal("ref"), v: z.string() }),
  ]),
});

export const nodeAddDef = {
  id: "node.add",
  title: "Add node",
  description:
    "Create a node with optional props, parent, position (index in its sibling group; the end when omitted), and tags. An omitted parent puts it where captures go, the capture target (today's node while days is on and its captures setting says today); pass parent: null for the top level.",
  mode: { kind: "write" } as const,
  targets: ["parent"],
  inputSchema: z.object({
    text: z.string(),
    props: z.array(PropInputSchema).optional(),
    parent: z
      .string()
      .nullable()
      .optional()
      .describe(
        "the node it goes under; null for the top level; omitted, the capture target (today's node while days is on)",
      ),
    position: z.number().int().nonnegative().optional(),
    tags: z.array(z.string()).optional(),
    id: z.string().optional(),
    /** Bypass sys.* write-guard (browse yes / break no). */
    force: z.boolean().optional(),
  }),
  outputSchema: z.object({
    id: z.string(),
    node: z.record(z.string(), z.unknown()),
  }),
} satisfies ActionDefinition;

export const nodeUpdateDef = {
  id: "node.update",
  title: "Update node",
  description: "Edit text, set/unset props, or move a node",
  mode: { kind: "write" } as const,
  targets: ["id", "parent"],
  // "Rename this": a call made in a tab session may leave out the node it edits.
  context: { id: "focused" },
  inputSchema: z.object({
    id: z.string(),
    text: z.string().optional(),
    setProps: z.array(PropInputSchema).optional(),
    unsetProps: z.array(z.object({ field: z.string(), value: z.unknown().optional() })).optional(),
    /** Move under this parent, or to the forest roots when null. */
    parent: z.string().nullable().optional(),
    /** Index in the target sibling group; the end when omitted on a move. */
    position: z.number().int().nonnegative().optional(),
    /** Bypass sys.* write-guard (browse yes / break no). */
    force: z.boolean().optional(),
  }),
  outputSchema: z.object({
    id: z.string(),
    node: z.record(z.string(), z.unknown()),
  }),
} satisfies ActionDefinition;

/**
 * Deleting is its own action, not a flag on `node.update`: it is the one
 * write whose loss a person cannot see in the node that remains, so it is
 * the write a caller (a guard, a person reading a tool list) most
 * needs to name on its own.
 */
export const nodeDeleteDef = {
  id: "node.delete",
  title: "Delete node",
  description: "Delete a node and, by default, its descendants (reparent keeps them)",
  mode: { kind: "write" } as const,
  targets: ["id"],
  inputSchema: z.object({
    id: z.string(),
    /** Parent deletion is never implicitly shallow; cascade is the default. */
    descendants: z.enum(["cascade", "reparent"]).optional(),
    /** Bypass sys.* write-guard (browse yes / break no). */
    force: z.boolean().optional(),
  }),
  outputSchema: z.object({
    id: z.string(),
    deleted: z.literal(true),
  }),
} satisfies ActionDefinition;

/**
 * Merging one node into another is one write, so it commits as one
 * transaction: the other takes its text after its own and its children
 * after its own, ranked there as a placement is (`placedRank`), and it is
 * deleted. Made as the update and the delete it is (`batchOf`), so a guard
 * on either governs it; and whole, so the commit takes or refuses all of
 * it, never the text without the children.
 */
export const nodeMergeDef = {
  id: "node.merge",
  title: "Merge node",
  description:
    "Merge a node into another: its text is appended to the other's, its children follow the other's, and it is deleted, in one transaction",
  mode: { kind: "write" } as const,
  targets: ["id", "into"],
  batchOf: [nodeUpdateDef.id, nodeDeleteDef.id],
  inputSchema: z.object({
    id: z.string(),
    into: z.string(),
    /** Bypass sys.* write-guard (browse yes / break no). */
    force: z.boolean().optional(),
  }),
  outputSchema: z.object({
    id: z.string(),
    node: z.record(z.string(), z.unknown()),
  }),
} satisfies ActionDefinition;

export const nodeGetDef = {
  id: "node.get",
  title: "Get node",
  description: "Pull a node subtree to depth N",
  mode: { kind: "read" } as const,
  inputSchema: z.object({
    id: z.string(),
    depth: z.number().int().nonnegative().default(1),
  }),
  outputSchema: z.object({
    node: z.unknown(),
  }),
} satisfies ActionDefinition;

export const fieldDefineDef = {
  id: "field.define",
  title: "Define field",
  description: "Mint a field node (typed sys.field)",
  mode: { kind: "write" } as const,
  inputSchema: z.object({
    name: z.string(),
    id: z.string().optional(),
  }),
  outputSchema: z.object({ id: z.string() }),
} satisfies ActionDefinition;

export const tagDefineDef = {
  id: "tag.define",
  title: "Define tag",
  description:
    "Mint a tag node (typed sys.tag) with optional templated fields, and the tags it extends",
  mode: { kind: "write" } as const,
  inputSchema: z.object({
    name: z.string(),
    id: z.string().optional(),
    fields: z.array(z.string()).optional(),
    /** The tags it extends (`sys.f.extends`), by name or id, in order. */
    extends: z.array(z.string()).optional(),
  }),
  outputSchema: z.object({ id: z.string() }),
} satisfies ActionDefinition;

export const graphQueryDef = {
  id: "graph.query",
  title: "Query graph",
  description: "Run a raw EDN datalog query → JSON rows",
  mode: { kind: "read" } as const,
  inputSchema: z.object({
    query: z.string(),
    inputs: z.array(z.unknown()).optional(),
  }),
  outputSchema: z.object({
    rows: z.unknown(),
  }),
} satisfies ActionDefinition;

export const graphRunDef = {
  id: "graph.run",
  title: "Run saved query",
  description: "Execute a saved query from .kb/queries/<name>.edn",
  mode: { kind: "read" } as const,
  inputSchema: z.object({
    name: z.string(),
    inputs: z.array(z.unknown()).optional(),
  }),
  outputSchema: z.object({
    name: z.string(),
    query: z.string(),
    rows: z.unknown(),
  }),
} satisfies ActionDefinition;

export const graphSearchDef = {
  id: "graph.search",
  title: "Search nodes",
  description: "Case-insensitive substring search over node text (id + text rows)",
  mode: { kind: "read" } as const,
  inputSchema: z.object({
    text: z.string(),
    limit: z.number().int().nonnegative().optional(),
  }),
  outputSchema: z.object({
    rows: z.unknown(),
  }),
} satisfies ActionDefinition;

/** The most changes one `graph.changes` answer reads; a caller pages on from `through`. */
const GRAPH_CHANGES_MAX = 500;
/** The most recorded ops one `graph.changes` answer decodes (TxPage.maxBytes). */
const GRAPH_CHANGES_BYTES = 4 * 1024 * 1024;

const ChangeSchema = Schema.Struct({
  rev: Schema.Finite,
  at: Schema.String,
  actor: Schema.optionalKey(ActorSchema),
  session: Schema.optionalKey(Schema.String),
  via: Schema.optionalKey(Schema.String),
  wrote: Schema.Array(
    Schema.Struct({ id: Schema.String, text: Schema.String, tags: Schema.Array(Schema.String) }),
  ),
  deleted: Schema.Array(Schema.String),
});

export const graphChangesDef = {
  id: "graph.changes",
  title: "Changes since",
  description:
    "The transactions committed after rev `since`, oldest first, one page at a time: when, who made each (actor, tab session, the caller's via label) and which nodes it wrote or deleted. `viaPrefix` keeps the ones whose via is that label or one of its parts. Read on from `through` while it is below `head`. `complete` is false when the log no longer reaches back to `since`.",
  mode: { kind: "read" } as const,
  inputSchema: z.object({
    since: z.number().int().nonnegative(),
    viaPrefix: z.string().min(1).optional(),
    limit: z.number().int().positive().max(GRAPH_CHANGES_MAX).optional(),
  }),
  outputSchema: Schema.toStandardSchemaV1(
    Schema.toStandardJSONSchemaV1(
      Schema.Struct({
        head: Schema.Finite,
        through: Schema.Finite,
        complete: Schema.Boolean,
        changes: Schema.Array(ChangeSchema),
      }),
    ),
  ),
} satisfies ActionDefinition;

function nodeById(ctx: KbContext<NodeIndex>, id: NodeId): KbNode | undefined {
  return ctx.index.getNode(id);
}

/**
 * The session's stored graph as a write plan reads it (`NodeGraph`), indexed
 * once per invocation that needs it: a plan that writes several nodes in one
 * transaction `put`s each step's upserts into the same graph, so every step
 * sees what the steps before it wrote. Only stored nodes are in it — the
 * index's virtual nodes never reach the store, so a plan never reads one as a
 * parent or a taken id.
 */
export function sessionGraph(ctx: KbContext<NodeIndex>): IndexedNodes {
  return IndexedNodes.of(ctx.nodes);
}

export function requireNode(ctx: KbContext<NodeIndex>, id: NodeId): KbNode {
  const n = nodeById(ctx, id);
  if (!n) throw new ResolveError("not_found", `node not found: ${id}`, { id });
  return n;
}

export function cloneNode(n: KbNode): KbNode {
  return {
    ...n,
    props: Object.fromEntries(
      Object.entries(n.props).map(([k, v]) => [k, v.map((x) => ({ ...x }))]),
    ),
    children: [...n.children],
  };
}

/**
 * Write `entries` into `props`. What "set" means is the field's to say: a
 * many-valued field gains the value, and a `cardinality: one` field has it
 * *replaced* — the setting takes the new value in this same transaction,
 * whichever surface asked (CLI `kb set`, MCP, the UI's plans, undo). Two
 * entries for one single-valued field in one call still land both, and
 * `txIntegrityError` refuses that, because it names two values for one slot.
 */
// A field's cardinality is read from the plan graph, which holds stored
// nodes only. A field is never virtual (the virtual nodes are saved queries),
// so this reads what the session index would.
function isInSubtree(nodes: KbNode[], rootId: NodeId, targetId: NodeId): boolean {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const stack = [rootId];
  const seen = new Set<NodeId>();
  while (stack.length > 0) {
    const id = stack.pop();
    if (id === undefined) break;
    if (id === targetId) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    const n = byId.get(id);
    if (n) stack.push(...n.children);
  }
  return false;
}

function detachFromParents(nodes: KbNode[], childId: NodeId, at: string): KbNode[] {
  const touched: KbNode[] = [];
  for (const n of nodes) {
    if (!n.children.includes(childId)) continue;
    const c = cloneNode(n);
    c.children = c.children.filter((id) => id !== childId);
    c.updatedAt = at;
    touched.push(c);
  }
  return touched;
}

function collectSubtreeIds(nodes: KbNode[], rootId: NodeId): NodeId[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const result: NodeId[] = [];
  const seen = new Set<NodeId>();
  const stack = [rootId];
  while (stack.length > 0) {
    const id = stack.pop();
    if (id === undefined) break;
    if (seen.has(id)) continue;
    seen.add(id);
    result.push(id);
    stack.push(...(byId.get(id)?.children ?? []));
  }
  return result;
}

export function insertChild(
  parent: KbNode,
  childId: NodeId,
  at: string,
  position?: number,
): KbNode {
  const c = cloneNode(parent);
  const pos = position === undefined || position > c.children.length ? c.children.length : position;
  c.children = [...c.children.slice(0, pos), childId, ...c.children.slice(pos)];
  c.updatedAt = at;
  return c;
}

/**
 * The rank a node takes when it is placed at `position` in the sibling group
 * under `parent` (the forest roots when null), read from `groups` — the state
 * before the placement, which is why the node itself is excluded. The one
 * owner of the answer is `@kb/model`'s `rankForInsert`; the store's commit
 * settles it again against whatever it merges into.
 */
export function placedRank(
  groups: SiblingGroups<KbNode>,
  parent: NodeId | null,
  node: KbNode,
  position: number | undefined,
): string {
  const siblings = groups.slots(parent, node.id);
  return rankForInsert(siblings, position ?? siblings.length, node.order);
}

/** Prefer structured pull from our nodes map for reliable ordered depth. */
function pullSubtree(ctx: KbContext<NodeIndex>, id: NodeId, depth: number): unknown {
  const node = nodeById(ctx, id);
  if (!node) return null;

  const walk = (n: KbNode, d: number): Record<string, unknown> => {
    const base: Record<string, unknown> = {
      id: n.id,
      text: n.text,
      props: n.props,
      createdAt: n.createdAt,
      updatedAt: n.updatedAt,
    };
    if (d <= 0) return base;
    base.children = n.children.map((cid) => {
      const child = nodeById(ctx, cid);
      if (!child) return { id: cid, missing: true };
      return walk(child, d - 1);
    });
    return base;
  };
  return walk(node, depth);
}

/** One prop a write names: a field (by name or id) and the value it gains. */

/**
 * What one add says, whoever says it: `node.add`'s input, its props as
 * values of the model, and its place decided: under `parent`, or at the
 * top level without one.
 */
export type NodeAddPlanInput = Omit<
  z.infer<typeof nodeAddDef.inputSchema>,
  "props" | "id" | "parent"
> & {
  props?: readonly PropEntry[] | undefined;
  parent?: NodeId | undefined;
};

/**
 * What one add means, stated once: the new node, and its parent with the
 * child filed in, written into `graph` (checked, not stored). It returns the
 * ids it wrote; reading them back from `graph` gives the upserts. It throws
 * {@link ResolveError}, and a refused add writes nothing; the effects below
 * lift it.
 */
export function planNodeAdd(
  graph: NodeGraph,
  input: NodeAddPlanInput,
  id: NodeId,
  at: string,
): { node: KbNode; written: NodeId[] } {
  if (graph.has(id)) {
    throw new ResolveError("ambiguous", `node id already exists: ${id}`, { id });
  }

  const props: Record<NodeId, PropValue[]> = {};
  if (input.props) applyProps(graph, props, input.props);
  if (input.tags) {
    for (const tagName of input.tags) {
      const tagId = resolveTagIn(graph, tagName);
      const list = props[SYSTEM_IDS.typeField] ?? [];
      list.push({ t: "ref", v: tagId });
      props[SYSTEM_IDS.typeField] = list;
    }
  }

  const draft: KbNode = { id, text: input.text, props, children: [], createdAt: at, updatedAt: at };
  const parentId = input.parent;
  const node: KbNode = {
    ...draft,
    order: placedRank(graph, parentId ?? null, draft, input.position),
  };
  const written = parentId === undefined ? [id] : [id, parentId];
  if (parentId !== undefined && !graph.has(parentId)) {
    throw new ResolveError("not_found", `node not found: ${parentId}`, { id: parentId });
  }
  // Filed before it is put, so the node never passes through the roots.
  if (parentId !== undefined) graph.insertChild(parentId, id, input.position, at);
  graph.put(node);
  return { node, written };
}

/** `node.add`'s input with its place decided: under `parent`, or the top level for null. */
export type PlacedAddInput = Omit<z.infer<typeof nodeAddDef.inputSchema>, "parent"> & {
  readonly parent: NodeId | null;
};

/**
 * {@link planNodeAdd} over the session's graph, at a decided place, after
 * what the place needs `made` (a capture target's day, say), so both land in
 * one transaction. `nodeAddEffect` persists what it plans; a caller whose
 * write must land with another (a canvas card and its node) hands the
 * upserts to that write instead, so the two commit as one transaction.
 */
export const planNodeAddEffect = Effect.fn("node.add.plan")(function* (
  input: PlacedAddInput,
  made: readonly KbNode[] = [],
): Effect.fn.Return<{ id: string; node: KbNode; upserts: KbNode[] }, DomainError, KbCtx> {
  const ctx = yield* KbCtx;
  const at = yield* currentIso;
  const id = input.id ?? (yield* freshId);
  const { graph, upserts } = placedGraph(ctx.nodes, made);
  const { node, written } = yield* syncDomain(() =>
    planNodeAdd(graph, { ...input, parent: input.parent ?? undefined }, id, at),
  );
  return { id, node, upserts: upserts(written) };
});

/**
 * One add at the place `place` answers over the nodes it is planned from,
 * committed on that state (`persistPlannedEffect`): a place made for it, a
 * day say, is planned again over what another writer made meanwhile, never
 * written over it.
 */
const commitAddEffect = Effect.fn("node.add.commit")(function* <R>(
  input: Omit<z.infer<typeof nodeAddDef.inputSchema>, "parent">,
  place: (nodes: readonly KbNode[]) => Effect.Effect<CapturePlan, DomainError, R>,
): Effect.fn.Return<{ id: string; node: KbNode }, DomainError, KbWriteEnv | R> {
  const ctx = yield* KbCtx;
  const id = input.id ?? (yield* freshId);
  const plan = Effect.fn("node.add.placed")(function* (nodes: readonly KbNode[]) {
    const { parent, upserts: made } = yield* place(nodes);
    const add = yield* planNodeAddEffect({ ...input, id, parent }, made);
    return { ...add, deletes: [] };
  });
  const planned = yield* persistPlannedEffect(ctx, plan, forcedBy(input));
  const { node } = present(planned, "an add always writes");
  return { id, node };
});

/** `node.add`: one node at the place its input names ({@link placeOf}), the capture target's when it names none. */
export const nodeAddEffect = Effect.fn("node.add")(function* (
  input: z.infer<typeof nodeAddDef.inputSchema>,
): Effect.fn.Return<{ id: string; node: KbNode }, DomainError, KbCaptureEnv> {
  return yield* commitAddEffect(input, (nodes) => placeOf(input.parent, nodes));
});

/** One node at a place its caller decided, as `node.add` writes it: the capture target is never asked. */
export const addNodeAtEffect = Effect.fn("node.add.at")(function* (
  input: PlacedAddInput,
): Effect.fn.Return<{ id: string; node: KbNode }, DomainError, KbWriteEnv> {
  return yield* commitAddEffect(input, () => Effect.succeed({ parent: input.parent, upserts: [] }));
});

/**
 * How a node action's commit meets the system-write rule, which the commit
 * owns (`persistEffect`): checked, unless the owner set `force`.
 */
export function forcedBy(input: { readonly force?: boolean | undefined }): PersistOptions {
  return input.force === true ? { systemWrites: "forced" } : {};
}

export const nodeDeleteEffect = Effect.fn("node.delete")(function* (
  input: z.infer<typeof nodeDeleteDef.inputSchema>,
): Effect.fn.Return<{ id: string; deleted: true }, DomainError, KbWriteEnv> {
  const ctx = yield* KbCtx;
  const at = yield* currentIso;
  const deleteIds =
    input.descendants === "reparent" ? [input.id] : collectSubtreeIds(ctx.nodes, input.id);
  const upserts = detachFromParents(ctx.nodes, input.id, at);
  yield* persistEffect(ctx, { upserts, deletes: deleteIds }, forcedBy(input));
  return { id: input.id, deleted: true };
});

export const nodeUpdateEffect = Effect.fn("node.update")(function* (
  input: z.infer<typeof nodeUpdateDef.inputSchema>,
): Effect.fn.Return<{ id: string; node: KbNode }, DomainError, KbWriteEnv> {
  const ctx = yield* KbCtx;
  const at = yield* currentIso;

  const node = yield* syncDomain(() => cloneNode(requireNode(ctx, input.id)));
  const upserts: KbNode[] = [];
  // Indexed at most once, and only when a prop or a placement needs it: a
  // text edit reads no graph.
  let built: IndexedNodes | undefined;
  const graph = (): IndexedNodes => (built ??= sessionGraph(ctx));

  yield* syncDomain(() => {
    if (input.text !== undefined) node.text = input.text;
    if (input.unsetProps !== undefined || input.setProps !== undefined)
      node.props = projectPropEdits(graph(), node.props, input);
  });

  // A placement is a move to `parent` (null: the forest roots), or — with
  // only `position` — a reorder inside the group the node is already in. Both
  // are one mechanism: leave the old group, join the new one at `position`,
  // and take the rank that position implies.
  const placement =
    input.parent !== undefined
      ? input.parent
      : input.position !== undefined
        ? (ctx.nodes.find((n) => n.children.includes(input.id))?.id ?? null)
        : undefined;
  if (placement !== undefined) {
    if (placement !== null && isInSubtree(ctx.nodes, input.id, placement)) {
      return yield* domainError(
        "invalid_move",
        `cannot move ${input.id} under itself or its own descendant ${placement}`,
        { id: input.id, parent: placement },
      );
    }
    node.order = placedRank(graph(), placement, node, input.position);
    upserts.push(...detachFromParents(ctx.nodes, input.id, at));
    if (placement !== null) {
      const parent = yield* syncDomain(
        () => upserts.find((n) => n.id === placement) ?? cloneNode(requireNode(ctx, placement)),
      );
      const updated = insertChild(parent, input.id, at, input.position);
      const idx = upserts.findIndex((n) => n.id === parent.id);
      if (idx >= 0) upserts[idx] = updated;
      else upserts.push(updated);
    }
  }

  node.updatedAt = at;
  upserts.push(node);
  yield* persistEffect(ctx, { upserts, deletes: [] }, forcedBy(input));
  return { id: input.id, node };
});

export const nodeMergeEffect = Effect.fn("node.merge")(function* (
  input: z.infer<typeof nodeMergeDef.inputSchema>,
): Effect.fn.Return<{ id: string; node: KbNode }, DomainError, KbWriteEnv> {
  const ctx = yield* KbCtx;
  const at = yield* currentIso;
  if (isInSubtree(ctx.nodes, input.id, input.into)) {
    return yield* domainError(
      "invalid_move",
      `cannot merge ${input.id} into itself or its own descendant ${input.into}`,
      { id: input.id, into: input.into },
    );
  }
  const source = yield* syncDomain(() => requireNode(ctx, input.id));
  const parents = detachFromParents(ctx.nodes, input.id, at);
  const target = yield* syncDomain(() =>
    cloneNode(parents.find((n) => n.id === input.into) ?? requireNode(ctx, input.into)),
  );
  // Each child joins the group after the last, ranked as a placement there is.
  const graph = sessionGraph(ctx);
  const group: RankSlot[] = target.children.flatMap((id) => graph.get(id) ?? []);
  const moved = source.children.flatMap((id) => {
    const child = graph.get(id);
    if (child === undefined) return [];
    const placed = { ...cloneNode(child), order: rankForInsert(group, group.length, child.order) };
    placed.updatedAt = at;
    group.push(placed);
    return [placed];
  });
  target.text += source.text;
  target.children = [...target.children, ...source.children];
  target.updatedAt = at;
  const upserts = [...parents.filter((n) => n.id !== target.id), target, ...moved];
  yield* persistEffect(ctx, { upserts, deletes: [input.id] }, forcedBy(input));
  return { id: target.id, node: target };
});

export const nodeGetEffect = Effect.fn("node.get")(function* (
  input: z.infer<typeof nodeGetDef.inputSchema>,
): Effect.fn.Return<{ node: unknown }, DomainError, KbCtx> {
  const ctx = yield* KbCtx;
  yield* syncDomain(() => requireNode(ctx, input.id));
  return { node: pullSubtree(ctx, input.id, input.depth) };
});

export const fieldDefineEffect = Effect.fn("field.define")(function* (
  input: z.infer<typeof fieldDefineDef.inputSchema>,
): Effect.fn.Return<{ id: string }, DomainError, KbWriteEnv> {
  const ctx = yield* KbCtx;
  const existing = ctx.nodes.filter(
    (n) =>
      n.text === input.name &&
      (n.props[SYSTEM_IDS.typeField] ?? []).some((v) => v.t === "ref" && v.v === SYSTEM_IDS.field),
  );
  if (existing.length > 0 && (input.id === undefined || input.id === "")) {
    return yield* domainError("ambiguous", `field already exists: ${input.name}`, {
      ids: existing.map((e) => e.id),
    });
  }
  const result = yield* addNodeAtEffect({
    id: input.id,
    text: input.name,
    parent: null,
    props: [
      {
        field: SYSTEM_IDS.typeField,
        value: { t: "ref", v: SYSTEM_IDS.field },
      },
    ],
  });
  return { id: result.id };
});

export const tagDefineEffect = Effect.fn("tag.define")(function* (
  input: z.infer<typeof tagDefineDef.inputSchema>,
): Effect.fn.Return<{ id: string }, DomainError, KbWriteEnv> {
  const ctx = yield* KbCtx;
  const props: z.infer<typeof PropInputSchema>[] = [
    {
      field: SYSTEM_IDS.typeField,
      value: { t: "ref", v: SYSTEM_IDS.tag },
    },
  ];
  yield* syncDomain(() => {
    if (input.fields) {
      for (const f of input.fields) {
        const fieldId = resolveFieldId(ctx.nodes, f);
        props.push({
          field: SYSTEM_IDS.fieldsField,
          value: { t: "ref", v: fieldId },
        });
      }
    }
    // A tag no node names yet extends what it likes: it closes no cycle.
    for (const parent of input.extends ?? []) {
      props.push({
        field: SYSTEM_IDS.extendsField,
        value: { t: "ref", v: resolveTagId(ctx.nodes, parent) },
      });
    }
  });
  const result = yield* addNodeAtEffect({
    id: input.id,
    text: input.name,
    parent: null,
    props,
  });
  return { id: result.id };
});

/**
 * Map a query-layer failure to a typed domain error. Datalog errors thrown by
 * the datascript engine (parse/eval of the user's EDN) are `invalid_input`;
 * anything else — a genuine defect in our glue (normalization, revive) — stays
 * `internal` so internal bugs are never hidden behind an "invalid query" code.
 */
export function classifyQueryError(err: unknown, queryString: string): DomainError {
  if (err instanceof DatalogError) {
    return domainError("invalid_input", `invalid datalog query: ${err.message}`, {
      query: queryString,
    });
  }
  return domainError(
    "internal",
    `graph query failed: ${err instanceof Error ? err.message : String(err)}`,
    { query: queryString },
  );
}

/** Shared datalog execution for graph.query / graph.run, on whichever engine the host runs. */
const runDatalog = Effect.fn("runDatalog")(function* (
  edn: string,
  inputs?: unknown[],
): Effect.fn.Return<unknown[][], DomainError, QueryEngineService> {
  const engine = yield* QueryEngineService;
  return yield* engine
    .runDatalog(edn, inputs)
    .pipe(Effect.mapError(({ cause }) => classifyQueryError(cause, edn)));
});

export const graphQueryEffect = Effect.fn("graph.query")(function* (
  input: z.infer<typeof graphQueryDef.inputSchema>,
): Effect.fn.Return<{ rows: unknown }, DomainError, QueryEngineService> {
  const rows = yield* runDatalog(input.query, input.inputs);
  return { rows };
});

export const graphRunEffect = Effect.fn("graph.run")(function* (
  input: z.infer<typeof graphRunDef.inputSchema>,
): Effect.fn.Return<
  z.infer<typeof graphRunDef.outputSchema>,
  DomainError,
  QueryEngineService | SavedQueries
> {
  const queries = yield* SavedQueries;
  const edn = yield* queries.read(input.name);
  if (edn === null) {
    return yield* domainError("not_found", `saved query not found: ${input.name}`, {
      name: input.name,
    });
  }
  const rows = yield* runDatalog(edn, input.inputs);
  return { name: input.name, query: edn.trim(), rows };
});

/** A node's tags as `graph.changes` reports them: the ids its type field refers to. */
function tagIdsOf(node: KbNode): string[] {
  return (node.props[SYSTEM_IDS.typeField] ?? []).flatMap((value) =>
    value.t === "ref" ? [value.v] : [],
  );
}

/**
 * One page of what the log holds past `since`, each transaction told as who
 * made it and what it touched. The log first adopts what other processes
 * committed (`refresh`), so the answer is the store's, not this session's
 * last look at it. `through` is the last rev the page read, filtered or not:
 * the caller reads on from it. A log that cannot reach back that far answers
 * no changes, `through: head` and `complete: false`.
 */
export const graphChangesEffect = Effect.fn("graph.changes")(function* (
  input: z.infer<typeof graphChangesDef.inputSchema>,
): Effect.fn.Return<typeof graphChangesDef.outputSchema.Type, DomainError, KbCtx> {
  const { log } = yield* KbCtx;
  log.refresh();
  const head = log.head;
  const txs = log.since(input.since, {
    limit: input.limit ?? GRAPH_CHANGES_MAX,
    maxBytes: GRAPH_CHANGES_BYTES,
  });
  if (txs === "snapshot-required") return { head, through: head, complete: false, changes: [] };
  const prefix = input.viaPrefix;
  const through = txs.at(-1)?.rev ?? head;
  const changes = txs
    .filter((tx) => prefix === undefined || (tx.via !== undefined && viaWithin(tx.via, prefix)))
    .map((tx) => ({
      rev: tx.rev,
      at: tx.at,
      ...(tx.actor === undefined ? {} : { actor: tx.actor }),
      ...(tx.session === undefined ? {} : { session: tx.session }),
      ...(tx.via === undefined ? {} : { via: tx.via }),
      wrote: tx.ops.upserts.map((node) => ({ id: node.id, text: node.text, tags: tagIdsOf(node) })),
      deleted: [...tx.ops.deletes],
    }));
  return { head, through, complete: true, changes };
});

export const graphSearchEffect = Effect.fn("graph.search")(function* (
  input: z.infer<typeof graphSearchDef.inputSchema>,
): Effect.fn.Return<{ rows: unknown[][] }, DomainError, KbCtx> {
  const { index } = yield* KbCtx;
  return { rows: index.search(input.text, input.limit).map((n) => [n.id, n.text]) };
});
