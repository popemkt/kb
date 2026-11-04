import { Context, Layer, Result, DateTime, Effect, Schema } from "effect";
import { z } from "zod";
import { onWire, viaWithin, WireNodeSchema, type UiHostService } from "@kb/contracts";
import { canonicalJson, type NodeLike, type PropValue } from "@kb/model";
import {
  routineOption,
  ROUTINE_FIELDS as F,
  ROUTINE_TAGS as T,
  SyncError,
  type SyncStatus,
} from "@kb/routines";

export interface TailChange {
  readonly at: number;
  readonly ids: readonly string[];
  readonly via: string | null;
}
export interface TailPage {
  readonly head: number;
  readonly through: number;
  readonly complete: boolean;
  readonly changes: readonly TailChange[];
}
export interface RoutineHost {
  readonly read: Effect.Effect<ReadonlyMap<string, NodeLike>, SyncError>;
  readonly changes: (since: number) => Effect.Effect<TailPage, SyncError>;
  readonly trusted: (digest: string) => Effect.Effect<boolean, SyncError>;
  readonly status: (id: string, status: SyncStatus) => Effect.Effect<void, SyncError>;
}
const Node = WireNodeSchema.pick({ id: true, text: true, props: true });
const Tree = Node.extend({ children: z.array(Node).optional() });
const Changes = Schema.Struct({
  head: Schema.Int,
  through: Schema.Int,
  complete: Schema.Boolean,
  changes: Schema.Array(
    Schema.Struct({
      at: Schema.String,
      via: Schema.optionalKey(Schema.String),
      wrote: Schema.Array(Schema.Struct({ id: Schema.String })),
      deleted: Schema.Array(Schema.String),
    }),
  ),
});
const unavailable = () => new SyncError({ status: 500, code: "graph_unavailable" });
const invalid = () => new SyncError({ status: 502, code: "invalid_graph_response" });

export function makeRoutineHost(host: UiHostService): RoutineHost {
  const call = Effect.fn("routines.graph.call")(function* (id: string, input: unknown) {
    const receipt = yield* host.invoke(
      onWire({ actor: "agent", carriesApproval: false }, { id, input, via: "ext.routines.sync" }),
    );
    if (receipt.status === "failed")
      return yield* new SyncError({
        status: receipt.code === "not_found" ? 404 : 500,
        code: "graph_unavailable",
      });
    return receipt.output;
  });
  const node = Effect.fn("routines.graph.node")(function* (id: string) {
    const raw = yield* call("node.get", { id, depth: 0 });
    const parsed = z.object({ node: Node }).safeParse(raw);
    if (!parsed.success) return yield* invalid();
    return parsed.data.node;
  });
  const replace = Effect.fn("routines.graph.replace")(function* (
    id: string,
    values: Readonly<Record<string, PropValue | null>>,
  ) {
    const current = yield* Effect.result(node(id));
    if (Result.isFailure(current)) {
      if (current.failure.status === 404) return undefined;
      return yield* current.failure;
    }
    const changed = Object.entries(values).filter(
      ([field, value]) =>
        canonicalJson(current.success.props[field] ?? []) !==
        canonicalJson(value === null ? [] : [value]),
    );
    if (changed.length !== 0)
      yield* call("node.update", {
        id,
        unsetProps: changed.map(([field]) => ({ field })),
        setProps: changed.flatMap(([field, value]) => (value === null ? [] : [{ field, value }])),
      });
    return undefined;
  });
  const read = Effect.fn("routines.graph.read")(function* () {
    const kinds = [T.routine, T.calendar, T.account];
    const query =
      "[:find ?id :where [?n :node/id ?id] [?n :f/sys.f.type ?t] (or " +
      kinds.map((kind) => '[?t :node/id "' + kind + '"]').join(" ") +
      ")]";
    const result = z
      .object({ rows: z.array(z.tuple([z.string()])) })
      .safeParse(yield* call("graph.query", { query }));
    if (!result.success) return yield* invalid();
    const nodes = new Map<string, NodeLike>();
    for (const [id] of result.data.rows.toSorted(([a], [b]) => a.localeCompare(b))) {
      const raw = yield* call("node.get", { id, depth: 1 });
      const parsed = z.object({ node: Tree }).safeParse(raw);
      if (!parsed.success) return yield* invalid();
      const root = parsed.data.node;
      nodes.set(root.id, { ...root, children: (root.children ?? []).map((child) => child.id) });
      for (const child of root.children ?? [])
        if (!nodes.has(child.id)) nodes.set(child.id, { ...child, children: [] });
    }
    return nodes;
  });
  return {
    read: read(),
    changes: Effect.fn("routines.graph.changes")(function* (since) {
      const page = yield* Schema.decodeUnknownEffect(Changes)(
        yield* call("graph.changes", { since }),
      ).pipe(Effect.mapError(invalid));
      const changes = yield* Effect.try({
        try: () =>
          page.changes
            .filter(
              (entry) => entry.via === undefined || !viaWithin(entry.via, "ext.routines.sync"),
            )
            .map((entry) => ({
              at: DateTime.toEpochMillis(DateTime.makeUnsafe(entry.at)),
              ids: [...entry.wrote.map((written) => written.id), ...entry.deleted],
              via: entry.via ?? null,
            })),
        catch: invalid,
      });
      return { ...page, changes };
    }),
    trusted: Effect.fn("routines.graph.trusted")(function* (digest) {
      const result = z
        .object({ trusted: z.array(z.string()) })
        .safeParse(yield* call("sandbox.trusted", { digests: [digest] }));
      if (!result.success) return yield* unavailable();
      return result.data.trusted.includes(digest);
    }),
    status: (id, status) =>
      replace(id, {
        [F.status]: { t: "ref", v: routineOption("status", status.state) },
        [F.message]: status.message === "" ? null : { t: "str", v: status.message },
        ...(status.eventId === undefined ? {} : { [F.eventId]: { t: "str", v: status.eventId } }),
        ...(status.url === undefined ? {} : { [F.gcal]: { t: "str", v: status.url } }),
        ...(status.at === undefined ? {} : { [F.syncedAt]: { t: "str", v: status.at } }),
      }),
  };
}

export class RoutineGraph extends Context.Service<RoutineGraph, RoutineHost>()(
  "@kb/routines/Graph",
) {
  static layer(host: UiHostService) {
    return Layer.succeed(RoutineGraph, makeRoutineHost(host));
  }
}
