/**
 * `ext.canvas.import` (DESIGN.md → Canvas documents → Import): a tldraw
 * board brought into kb one way, lowered to kb's own features by
 * `@kb/canvas`'s `tldrawBoard`, and written as one transaction — the board
 * and its pages as `#canvas` nodes, each record card's node under its
 * page, and the fields its meta keys name that kb does not have yet.
 */
import { isAbsolute, join } from "node:path";
import { Effect } from "effect";
import { FileSystem } from "effect/FileSystem";
import { z } from "zod";
import { KbCtx, type ExtensionAction } from "@kb/contracts";
import {
  IndexedNodes,
  ResolveError,
  SYSTEM_IDS,
  currentIso,
  freshId,
  isSysPrefixed,
  present,
  resolveFieldIn,
  FIELD_TYPE_OPTION_IDS,
  conformsToType,
  fieldTypeOf,
  type FieldType,
  type NodeId,
  type PropValue,
} from "@kb/model";
import { persistEffect, planNodeAdd, type PropEntry } from "@kb/operations";
import {
  CANVAS_IDS,
  canvasWorld,
  lintCanvas,
  stringifyCanvasDoc,
  tldrawBoard,
  tldrawKeys,
  type CanvasDoc,
  type CanvasWorld,
  type TldrawValue,
} from "@kb/canvas";
import { LintSchema } from "./lints.ts";
import { tldrawRecords } from "./tldraw-file.ts";
import { CanvasTxError, canvasStep, type CanvasFail, type CanvasWriteEnv } from "./write.ts";

const importInput = z.object({
  path: z
    .string()
    .min(1)
    .describe("the .tldraw or .tldr file: absolute, or relative to the workspace root"),
  name: z.string().min(1).optional().describe("the board's name; its first page's when absent"),
  parent: z
    .string()
    .min(1)
    .optional()
    .describe("the node the board is filed under; the outline's roots when absent"),
});

const importOutput = z.object({
  canvasId: z.string().describe("the board: its first page"),
  pages: z.array(
    z.object({ id: z.string(), name: z.string(), items: z.number(), edges: z.number() }),
  ),
  records: z.number().describe("the nodes made for cards that carried a record (meta)"),
  fields: z
    .array(z.object({ name: z.string(), id: z.string(), made: z.boolean(), type: z.string() }))
    .describe(
      "the fields the records are written in, their type, and whether the import made each (typed by its values)",
    ),
  reported: z.array(z.string()).describe("what kb drew differently, or not at all"),
  lints: z.array(LintSchema.extend({ page: z.string() })),
});

/** The type a field made for `values` is declared: number or checkbox when every value is one, text otherwise. */
function typeFor(values: readonly TldrawValue[]): FieldType {
  if (values.every((v) => typeof v === "number")) return "number";
  if (values.every((v) => typeof v === "boolean")) return "checkbox";
  return "text";
}

/** A meta value as a value of a field of `type`: a number or a truth as itself where it takes one, words otherwise. */
function propValue(value: TldrawValue, type: FieldType): PropValue {
  if (type === "number" && typeof value === "number") return { t: "num", v: value };
  if (type === "checkbox" && typeof value === "boolean") return { t: "bool", v: value };
  return { t: "str", v: String(value) };
}

/**
 * The field `name` resolves to, or null when kb has none of that name and
 * the import is to make it. A name that is kb's own (a `sys.*` field, or
 * one of the names the system's fields answer to) is refused: a record's
 * key is the person's, and must not write kb's schema.
 */
function fieldFor(graph: IndexedNodes, name: string): NodeId | null {
  try {
    const id = resolveFieldIn(graph, name);
    if (isSysPrefixed(id)) {
      throw new CanvasTxError(`the meta key "${name}" names kb's own field ${id}; rename it first`);
    }
    return id;
  } catch (err) {
    if (err instanceof ResolveError && err.code === "not_found") return null;
    throw err;
  }
}

/**
 * Every page's lints, each said once: a lint about the board (a page none
 * reaches) is found from every page, and is the first page's to report.
 */
function boardLints(
  pages: readonly { id: NodeId; doc: CanvasDoc }[],
  world: CanvasWorld,
): z.infer<typeof importOutput>["lints"] {
  const seen = new Set<string>();
  return pages.flatMap(({ id, doc }) =>
    lintCanvas(id, doc, world).flatMap((lint) => {
      const key = `${lint.rule}\u0000${lint.ids.join(",")}\u0000${lint.message}`;
      if (seen.has(key)) return [];
      seen.add(key);
      return [{ ...lint, page: id }];
    }),
  );
}

const canvasImportEffect = Effect.fn("ext.canvas.import")(function* (
  input: z.infer<typeof importInput>,
): Effect.fn.Return<z.infer<typeof importOutput>, CanvasFail, CanvasWriteEnv> {
  const ctx = yield* KbCtx;
  const fs = yield* FileSystem;
  const path = isAbsolute(input.path) ? input.path : join(ctx.root, input.path);
  const bytes = yield* fs
    .readFile(path)
    .pipe(Effect.mapError((err) => new CanvasTxError(`cannot read ${input.path}: ${err.message}`)));
  const records = yield* canvasStep(() => tldrawRecords(bytes));
  const keys = tldrawKeys(records);
  if (keys.pages.length === 0) {
    return yield* Effect.fail(new CanvasTxError(`${input.path} holds no page`));
  }
  const ids = new Map<string, NodeId>();
  for (const key of [...keys.pages, ...keys.records]) ids.set(key, yield* freshId);
  const idOf = (key: string) => present(ids.get(key), `an id was minted for ${key}`);
  const board = tldrawBoard(records, { page: idOf, record: idOf });
  const at = yield* currentIso;
  const graph = IndexedNodes.of(ctx.nodes);
  const written = new Set<NodeId>();
  /** One node planned into the graph the import writes, as `node.add` plans one. */
  const add = (node: Parameters<typeof planNodeAdd>[1], id: NodeId, when: string) => {
    for (const w of planNodeAdd(graph, node, id, when).written) written.add(w);
  };
  const canvasId = idOf(present(keys.pages[0], "a board has a page"));
  const fields = new Map<string, { id: NodeId; made: boolean; type: FieldType }>();
  yield* canvasStep(() => {
    board.pages.forEach((page, i) => {
      const isBoard = i === 0;
      const parent = isBoard ? input.parent : canvasId;
      add(
        {
          text: isBoard && input.name !== undefined ? input.name : page.name,
          tags: ["canvas"],
          props: [
            { field: CANVAS_IDS.canvasField, value: { t: "str", v: stringifyCanvasDoc(page.doc) } },
          ],
          ...(parent === undefined ? {} : { parent }),
        },
        idOf(page.key),
        at,
      );
    });
  });
  const valuesByName = new Map<string, TldrawValue[]>();
  for (const { name, values } of board.records.flatMap((r) => r.fields)) {
    valuesByName.set(name, [...(valuesByName.get(name) ?? []), ...values]);
  }
  for (const [name, values] of valuesByName) {
    const found = yield* canvasStep(() => fieldFor(graph, name));
    if (found !== null) {
      fields.set(name, { id: found, made: false, type: fieldTypeOf(graph.get(found)?.props) });
      continue;
    }
    const id = yield* freshId;
    const type = typeFor(values);
    yield* canvasStep(() =>
      add(
        {
          text: name,
          props: [
            { field: SYSTEM_IDS.typeField, value: { t: "ref", v: SYSTEM_IDS.field } },
            {
              field: SYSTEM_IDS.fieldTypeField,
              value: { t: "ref", v: FIELD_TYPE_OPTION_IDS[type] },
            },
          ],
        },
        id,
        at,
      ),
    );
    fields.set(name, { id, made: true, type });
  }
  yield* canvasStep(() => {
    for (const record of board.records) {
      const props: PropEntry[] = record.fields.flatMap(({ name, values }) => {
        const field = present(fields.get(name), name);
        return values.map((raw) => {
          const value = propValue(raw, field.type);
          if (!conformsToType(field.type, value)) {
            throw new CanvasTxError(
              `${record.key}: the meta key "${name}" holds ${JSON.stringify(raw)}, which its field ${field.id} (${field.type}) cannot`,
            );
          }
          return { field: field.id, value };
        });
      });
      add({ text: record.text, props, parent: idOf(record.page) }, idOf(record.key), at);
    }
  });
  const upserts = [...written].map((id) =>
    present(graph.get(id), "a planned node is in the graph"),
  );
  yield* persistEffect(ctx, { upserts, deletes: [] });
  const world = canvasWorld([...ctx.nodes, ...upserts]);
  return {
    canvasId,
    pages: board.pages.map((page) => ({
      id: idOf(page.key),
      name: page.name,
      items: page.doc.nodes.length,
      edges: page.doc.edges.length,
    })),
    records: board.records.length,
    fields: [...fields].map(([name, { id, made, type }]) => ({ name, id, made, type })),
    reported: [...board.reported],
    lints: boardLints(
      board.pages.map((page) => ({ id: idOf(page.key), doc: page.doc })),
      world,
    ),
  };
});

export const IMPORT_VERB: ExtensionAction = {
  id: "import",
  title: "Import a tldraw board",
  description:
    "Bring a tldraw board (.tldraw or .tldr) into kb, one way: its first page becomes a #canvas " +
    "board and its other pages the board's pages; frames become frames, geo shapes shapes, text " +
    "text, bound arrows edges; colours and looks map to kb's nearest. A card carrying meta becomes " +
    "a node (its rich text as markdown, each meta key a field) shown by a card; meta.drill " +
    "{to, focus} becomes the item's link, so a drill badge is a control. What kb does not draw is " +
    "reported. Nothing of tldraw's format is kept, and there is no export back.",
  mode: { kind: "write" },
  // It reads a file and makes nodes at the root: no code's to call.
  inputSchema: importInput,
  outputSchema: importOutput,
  effect: canvasImportEffect,
};
