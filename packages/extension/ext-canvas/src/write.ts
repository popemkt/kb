/**
 * The canvas family's one write path (DESIGN.md → Canvas documents): a
 * `#canvas` node's document is read from `sys.f.canvas` and written back
 * whole, in one store transaction with whatever else the same act writes —
 * a source node's ref prop for a native edge bind. Every canvas action
 * writes through {@link commitCanvasEffect}, or makes a new canvas through
 * {@link createCanvasEffect}; nothing else sets the field, and every write
 * to a canvas answers what it did to its lints.
 */
import { Effect } from "effect";
import type { FileSystem } from "effect/FileSystem";
import { CurrentCall, GraphWrites, KbCtx, type KbContext } from "@kb/contracts";
import { KbIndexService, type NodeIndex } from "@kb/query";
import { readableNodes, readableQuery } from "@kb/sandbox";
import {
  isSysPrefixed,
  currentIso,
  freshId,
  IndexedNodes,
  planNodeAdd,
  present,
  syncDomain,
  type NodeAddPlanInput,
  ResolveError,
  domainError,
  domainFromResolve,
  resolveFieldId,
  type DomainError,
  type KbNode,
  type NodeId,
  type PropValue,
} from "@kb/model";
import {
  CANVAS_IDS,
  CanvasRelationError,
  canvasWorld,
  isCanvasNode,
  lintCanvas,
  lintDiff,
  parseCanvasDoc,
  stringifyCanvasDoc,
  type CanvasDoc,
  type CanvasLintDiff,
} from "@kb/canvas";

export class CanvasTxError extends Error {
  readonly code = "invalid_input" as const;
  readonly details?: unknown;

  constructor(message: string, details?: unknown) {
    super(message);
    this.name = "CanvasTxError";
    this.details = details;
  }
}

export type CanvasFail = DomainError | CanvasTxError;

function cloneNode(n: KbNode): KbNode {
  return {
    ...n,
    props: Object.fromEntries(
      Object.entries(n.props).map(([k, v]) => [k, v.map((x) => ({ ...x }))]),
    ),
    children: [...n.children],
  };
}

function requireNode(ctx: KbContext<NodeIndex>, id: NodeId): KbNode {
  const n = ctx.nodes.find((x) => x.id === id);
  if (!n) throw new ResolveError("not_found", `node not found: ${id}`, { id });
  return n;
}

function assertUserWritable(id: string): void {
  if (isSysPrefixed(id)) {
    throw new ResolveError("forbidden", `sys.* nodes are write-protected: ${id}`, { id });
  }
}

/** The node `id`, when it is a canvas a write may take (`isCanvasNode`); throws otherwise. */
function assertCanvasHost(ctx: KbContext<NodeIndex>, id: NodeId): KbNode {
  assertUserWritable(id);
  const node = requireNode(ctx, id);
  if (!isCanvasNode(node)) {
    throw new CanvasTxError(`canvas host must be tagged #canvas: ${id}`, { id });
  }
  return node;
}

/** A failure thrown by a synchronous step, as the canvas actions fail. */
function canvasFailure(err: unknown): CanvasFail {
  if (err instanceof CanvasTxError) return err;
  // A relation the canvas cannot resolve is the caller's to fix, in its words.
  if (err instanceof CanvasRelationError) return new CanvasTxError(err.message);
  if (err instanceof ResolveError) return domainFromResolve(err);
  return domainError("internal", err instanceof Error ? err.message : String(err));
}

/** Run a synchronous step that may throw, failing as the canvas actions fail. */
export function canvasStep<A>(step: () => A): Effect.Effect<A, CanvasFail> {
  return Effect.try({ try: step, catch: canvasFailure });
}

/** The document `raw` (a string or an object), or why it is not one. */
export function parseDocEffect(
  raw: unknown,
  canvasId: string,
): Effect.Effect<CanvasDoc, CanvasFail> {
  return Effect.try({
    try: () => parseCanvasDoc(raw),
    catch: (err) =>
      new CanvasTxError(`invalid canvas doc: ${err instanceof Error ? err.message : String(err)}`, {
        canvasId,
      }),
  });
}

/** A prop a canvas write sets on a node beside the document: a field (name or id) and a value. */
export interface CanvasPropSet {
  readonly field: string;
  readonly value: PropValue;
}

/** A prop a canvas write unsets: every value of the field, or the one given. */
export interface CanvasPropUnset {
  readonly field: string;
  readonly value?: unknown;
}

/**
 * Node `id` with `set` added and `unset` taken away, stamped `at`: the
 * other node a native edge bind or unbind writes beside the document.
 */
export function withPropOps(
  nodes: KbNode[],
  id: NodeId,
  ops: { readonly set?: readonly CanvasPropSet[]; readonly unset?: readonly CanvasPropUnset[] },
  at: string,
): KbNode {
  assertUserWritable(id);
  const found = nodes.find((n) => n.id === id);
  if (found === undefined) throw new ResolveError("not_found", `node not found: ${id}`, { id });
  const node = cloneNode(found);
  const { props } = node;
  for (const e of ops.set ?? []) {
    const fieldId = resolveFieldId(nodes, e.field);
    props[fieldId] = [...(props[fieldId] ?? []), e.value];
  }
  for (const u of ops.unset ?? []) {
    const fieldId = resolveFieldId(nodes, u.field);
    const kept =
      u.value === undefined
        ? []
        : (props[fieldId] ?? []).filter((pv) => JSON.stringify(pv) !== JSON.stringify(u.value));
    if (kept.length === 0) delete props[fieldId];
    else props[fieldId] = kept;
  }
  node.updatedAt = at;
  return node;
}

/** The document a `#canvas` node holds; an empty canvas when it holds none it can read. */
function storedDoc(host: KbNode): CanvasDoc {
  const raw = host.props[CANVAS_IDS.canvasField]?.[0];
  if (raw === undefined || raw.t !== "str") return { nodes: [], edges: [] };
  try {
    return parseCanvasDoc(raw.v);
  } catch {
    return { nodes: [], edges: [] };
  }
}

/**
 * The document on the `#canvas` node `canvasId`, which a verb resolves its
 * relations against and writes back whole; refused when the node is not a
 * canvas, or holds a document kb cannot read — writing a verb's result over
 * it would lose everything else on it. A canvas with none is empty.
 */
export const readCanvasEffect = Effect.fn("ext.canvas.read")(function* (
  canvasId: string,
): Effect.fn.Return<CanvasDoc, CanvasFail, KbCtx> {
  const ctx = yield* KbCtx;
  const host = yield* canvasStep(() => assertCanvasHost(ctx, canvasId));
  const raw = host.props[CANVAS_IDS.canvasField]?.[0];
  if (raw === undefined) return { nodes: [], edges: [] };
  if (raw.t !== "str") {
    return yield* Effect.fail(
      new CanvasTxError(`canvas ${canvasId} holds no document kb can read`),
    );
  }
  return yield* parseDocEffect(raw.v, canvasId);
});

/**
 * The nodes a canvas action reads kb through — the nodes its items stand
 * for, the canvases their links name, the outline round it — as its call
 * may read them (`readableNodes`), with `also`, what the same act writes,
 * over them. Every canvas action that reads kb beyond the document reads it
 * through these, so a script's description, lints and picture of its
 * canvas say nothing of a node beyond its subject.
 */
export const readableEffect = Effect.fn("ext.canvas.readable")(function* (
  also: readonly KbNode[] = [],
): Effect.fn.Return<KbNode[], never, KbCtx> {
  const ctx = yield* KbCtx;
  const call = yield* CurrentCall;
  return readableNodes(call?.invocation, [...ctx.nodes, ...also]);
});

/**
 * The datalog a canvas action runs for its call, answered as the call may
 * read it (`readableQuery`): a field's target query asked for a script that
 * reads its subject only answers nothing about a node beyond it.
 */
export const readableQueryEffect = Effect.fn("ext.canvas.readableQuery")(
  function* (): Effect.fn.Return<(edn: string) => unknown[][], never, KbCtx | KbIndexService> {
    const ctx = yield* KbCtx;
    const index = yield* KbIndexService;
    const call = yield* CurrentCall;
    return readableQuery(call?.invocation, ctx.nodes, (edn) => index.runDatalog(edn));
  },
);

/** What a canvas write needs: the kb it reads and core's write path it commits through. */
export type CanvasWriteEnv = KbCtx | GraphWrites | FileSystem;

/**
 * One node added over `nodes` as `node.add` adds one (`planNodeAdd`), with
 * the id `id`: the node, and its parent with the child filed in, as a write.
 */
export const planAddEffect = Effect.fn("ext.canvas.planAdd")(function* (
  nodes: readonly KbNode[],
  input: NodeAddPlanInput,
  id: NodeId,
): Effect.fn.Return<{ upserts: KbNode[]; deletes: NodeId[] }, DomainError> {
  const at = yield* currentIso;
  const graph = IndexedNodes.of(nodes);
  const { written } = yield* syncDomain(() => planNodeAdd(graph, input, id, at));
  const upserts = written.map((w) => present(graph.get(w), "a planned node is in the graph"));
  return { upserts, deletes: [] };
});

/**
 * The `#canvas` node `host` holding the document `docStr`, stamped `at`:
 * the prop replaced, not appended, since a canvas holds one current
 * document. How every canvas write writes a document.
 */
function holding(host: KbNode, docStr: string, at: string): KbNode {
  const canvas = cloneNode(host);
  canvas.props[CANVAS_IDS.canvasField] = [{ t: "str", v: docStr }];
  canvas.updatedAt = at;
  return canvas;
}

/**
 * The `#canvas` node `canvasId` as it is to be stored holding `doc`, for a
 * write that changes a second canvas beside its own (its `also`): refused
 * when the node is not a canvas a write may take.
 */
export const canvasWithDocEffect = Effect.fn("ext.canvas.withDoc")(function* (
  canvasId: string,
  doc: CanvasDoc,
): Effect.fn.Return<(at: string) => KbNode, CanvasFail, KbCtx> {
  const ctx = yield* KbCtx;
  const host = yield* canvasStep(() => assertCanvasHost(ctx, canvasId));
  const docStr = stringifyCanvasDoc(doc);
  return (at: string) => holding(host, docStr, at);
});

/** What one canvas write commits: the document, and the other nodes the same act changes. */
export interface CanvasWrite {
  readonly canvasId: string;
  readonly doc: CanvasDoc;
  /**
   * The other nodes this write changes, as they are to be stored, each
   * built from a clone (`cloneNode`) and stamped by the caller; written in
   * the same transaction as the document.
   */
  readonly also?: (at: string) => readonly KbNode[];
}

/** What a canvas write answers: the document as stored, and the lints it made and cleared. */
export interface CanvasWritten {
  readonly doc: string;
  readonly lints: CanvasLintDiff;
}

/**
 * Write `doc` onto the `#canvas` node `canvasId`, replacing the document it
 * holds, in one transaction with `also`. Nothing is written when the host is
 * not a canvas or a node `also` builds cannot be. Answers the document as
 * stored and what the write did to the canvas's lints (`lintDiff`), so
 * every canvas write's receipt says what it broke and what it fixed.
 */
export const commitCanvasEffect = Effect.fn("ext.canvas.commit")(function* (
  write: CanvasWrite,
): Effect.fn.Return<CanvasWritten, CanvasFail, CanvasWriteEnv> {
  const ctx = yield* KbCtx;
  const docStr = stringifyCanvasDoc(write.doc);
  // One stamp per transaction, from the Clock the store's replay overrides.
  const at = yield* currentIso;
  const host = yield* canvasStep(() => assertCanvasHost(ctx, write.canvasId));
  const canvas = holding(host, docStr, at);
  const also = yield* canvasStep(() => write.also?.(at) ?? []);
  // Each document is linted in the kb it stands in: the one before the write, and the one it leaves.
  const before = lintCanvas(
    write.canvasId,
    storedDoc(host),
    canvasWorld(yield* readableEffect(also)),
  );
  const after = lintCanvas(
    write.canvasId,
    write.doc,
    canvasWorld(yield* readableEffect([...also, canvas])),
  );
  const upserts = [canvas, ...also];
  yield* (yield* GraphWrites).commit(() => Effect.succeed({ upserts, deletes: [] }));
  return { doc: docStr, lints: lintDiff(before, after) };
});

/**
 * A new `#canvas` node called `name`, holding `doc`, filed under `parent`
 * (the forest roots when absent), in one transaction. Answers its id.
 */
export const createCanvasEffect = Effect.fn("ext.canvas.create")(function* (
  name: string,
  doc: CanvasDoc,
  parent?: string,
): Effect.fn.Return<string, CanvasFail, CanvasWriteEnv> {
  const id = yield* freshId;
  const add = {
    text: name,
    tags: ["canvas"],
    props: [
      { field: CANVAS_IDS.canvasField, value: { t: "str" as const, v: stringifyCanvasDoc(doc) } },
    ],
    parent,
  };
  yield* (yield* GraphWrites).commit((nodes) => planAddEffect(nodes, add, id));
  return id;
});
