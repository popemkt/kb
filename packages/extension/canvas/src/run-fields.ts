/** A canvas's script protocol binds field identities; labels are consulted only at adoption. */
import { Schema } from "effect";
import {
  IndexedNodes,
  ResolveError,
  resolveFieldIn,
  seededField,
  tagChains,
  fieldTypeOf,
  cardinalityOf,
  SYSTEM_IDS,
  type KbNode,
  type StoreTx,
  type NodeLike,
  type NodeLookup,
} from "@kb/model";

export const CANVAS_RUN_FIELDS = {
  input: { field: "sys.f.canvas.run.inputField", legacyName: "input" },
  output: { field: "sys.f.canvas.run.outputField", legacyName: "output" },
} as const;
export interface CanvasRunFields {
  readonly input: string;
  readonly output: string;
}
const Binding = Schema.Array(Schema.Struct({ t: Schema.Literal("ref"), v: Schema.String })).pipe(
  Schema.check(Schema.isLengthBetween(1, 1)),
);
const readBinding = Schema.decodeUnknownSync(Binding);

/** Validate selected identities without discovering or replacing absent bindings. */
export function canvasRunBindingsOf(
  canvas: NodeLike,
  nodeOf: NodeLookup,
): Partial<CanvasRunFields> {
  const fields: { input?: string; output?: string } = {};
  const kinds = tagChains(nodeOf);
  for (const role of ["input", "output"] as const) {
    const definition = CANVAS_RUN_FIELDS[role];
    const binding = canvas.props[definition.field];
    if (binding === undefined) continue;
    let id: string;
    try {
      const reference = readBinding(binding)[0];
      if (reference === undefined) throw new Error("missing reference");
      id = reference.v;
    } catch {
      throw new ResolveError(
        "forbidden",
        `canvas run ${role} binding must be one field reference; choose ${definition.field}`,
      );
    }
    const field = nodeOf(id);
    if (field === undefined || !kinds.isA(field, SYSTEM_IDS.field))
      throw new ResolveError(
        "not_found",
        `canvas run ${role} references missing field ${id}; choose ${definition.field}`,
      );
    if (
      fieldTypeOf(field.props, nodeOf) !== "text" ||
      cardinalityOf(field.props, nodeOf) !== "many"
    )
      throw new ResolveError(
        "forbidden",
        `canvas run ${role} field ${id} must accept multiple text values`,
      );
    fields[role] = id;
  }
  if (fields.input !== undefined && fields.input === fields.output)
    throw new ResolveError("forbidden", "canvas run input and output must use different fields");
  return fields;
}

/** Plan both ports before publishing either, using the conditional commit's authoritative snapshot. */
export function planCanvasRunFields(
  nodes: readonly KbNode[],
  canvasId: string,
  fresh: CanvasRunFields,
  at: string,
): { readonly fields: CanvasRunFields; readonly tx: StoreTx | null } {
  const graph = IndexedNodes.of(nodes);
  const canvas = graph.get(canvasId);
  if (canvas === undefined) throw new ResolveError("not_found", `no canvas ${canvasId}`);
  const held = canvasRunBindingsOf(canvas, (id) => graph.get(id));
  const created: KbNode[] = [];
  const fields = { input: "", output: "" };
  const props = { ...canvas.props };
  let changed = false;
  for (const role of ["input", "output"] as const) {
    const definition = CANVAS_RUN_FIELDS[role];
    let id = held[role];
    if (id === undefined) {
      try {
        id = resolveFieldIn(graph, definition.legacyName);
      } catch (error) {
        if (!(error instanceof ResolveError) || error.code !== "not_found")
          throw new ResolveError(
            "ambiguous",
            `cannot adopt canvas run ${role}; choose ${definition.field} explicitly`,
          );
        id = fresh[role];
        created.push(seededField(id, definition.legacyName, "text", at));
      }
      props[definition.field] = [{ t: "ref", v: id }];
      changed = true;
    }
    fields[role] = id;
  }
  canvasRunBindingsOf(
    { ...canvas, props },
    (id) => created.find((node) => node.id === id) ?? graph.get(id),
  );
  return {
    fields,
    tx: changed
      ? { upserts: [...created, { ...canvas, props, updatedAt: at }], deletes: [] }
      : null,
  };
}
