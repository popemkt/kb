/**
 * The verb an agent and a script change items in place with, by id
 * (DESIGN.md → Canvas documents → Agent verbs, `edit`): their words,
 * colour, looks, link, lock, node and size; a move by a delta; a delete;
 * and a move to another page of the board. Each change is `@kb/canvas`'s
 * (`editCanvas`, `takeItems`, `landItems`), made in order against the
 * document as the call reads it, and the whole is one canvas write, so an
 * agent never sends a whole document to change one card.
 */
import { Effect } from "effect";
import { z } from "zod";
import type { ExtensionAction } from "@kb/contracts";
import { editCanvas, landItems, takeItems, type CanvasDoc, type CanvasEdit } from "@kb/canvas";
import { LintDiffSchema } from "./lints.ts";
import { CanvasIdSchema, ColorSchema, LinkSchema, LooksSchema } from "./schemas.ts";
import {
  CanvasTxError,
  canvasStep,
  canvasWithDocEffect,
  commitCanvasEffect,
  readCanvasEffect,
  type CanvasFail,
  type CanvasWriteEnv,
} from "./write.ts";

const PatchSchema = z
  .object({
    text: z
      .string()
      .optional()
      .describe("its words: a text card's text, a shape's or frame's label"),
    color: ColorSchema.nullable().optional().describe("its colour; null, its kind's own"),
    style: LooksSchema.optional().describe("its looks beyond its colour; a look left out is kept"),
    link: LinkSchema.nullable().optional().describe("where it leads; null, nowhere"),
    locked: z
      .boolean()
      .optional()
      .describe("held where it is (a locked item that leads is a control)"),
    nodeId: z
      .string()
      .min(1)
      .nullable()
      .optional()
      .describe("the node it stands for, whose text are its words; null, none"),
    width: z.number().positive().optional(),
    height: z.number().positive().optional(),
  })
  .strict()
  .describe("what changes; a key left out is left as it is");

const IdsSchema = z.array(z.string().min(1)).min(1);

const EditSchema = z.union([
  z.object({ update: z.string().min(1).describe("the item changed"), set: PatchSchema }).strict(),
  z
    .object({
      move: IdsSchema.describe("the items moved, with their members"),
      by: z
        .object({ x: z.number(), y: z.number(), z: z.number().optional() })
        .strict()
        .describe("how far: x right, y down the page, z up"),
    })
    .strict(),
  z
    .object({
      delete: IdsSchema.describe(
        "items (with their members and the edges that meet them) and edges taken away",
      ),
    })
    .strict(),
  z
    .object({
      toPage: z.string().min(1).describe("another #canvas, a page of the board say"),
      ids: IdsSchema.describe(
        "the items moved there where they stand, with their members and the edges among them",
      ),
    })
    .strict(),
]);

const editInput = z.object({
  canvasId: CanvasIdSchema,
  edits: z.array(EditSchema).min(1).describe("made in order, as one write"),
});

const editOutput = z.object({
  canvasId: z.string(),
  changed: z.array(z.string()).describe("the items updated or moved"),
  deleted: z.array(z.string()).describe("the items and edges no longer on the canvas"),
  moved: z
    .array(z.object({ page: z.string(), ids: z.array(z.string()) }))
    .describe("the items each other page took"),
  lints: LintDiffSchema,
});

type Edit = z.infer<typeof EditSchema>;

/** An edit as `editCanvas` takes it; a move to a page is the verb's, across two documents. */
function canvasEditOf(edit: Exclude<Edit, { toPage: string }>): CanvasEdit {
  if ("update" in edit) return edit;
  if ("move" in edit) return { move: edit.move, by: { ...edit.by, z: edit.by.z ?? 0 } };
  return edit;
}

const ids = (doc: CanvasDoc) => new Set([...doc.nodes, ...doc.edges].map((record) => record.id));

const canvasEditEffect = Effect.fn("ext.canvas.edit")(function* (
  input: z.infer<typeof editInput>,
): Effect.fn.Return<z.infer<typeof editOutput>, CanvasFail, CanvasWriteEnv> {
  const before = yield* readCanvasEffect(input.canvasId);
  let doc = before;
  const changed = new Set<string>();
  const pages = new Map<string, { doc: CanvasDoc; ids: string[] }>();
  /** What another page took: its items, and the edges among them. */
  const carried = new Set<string>();
  for (const edit of input.edits) {
    if (!("toPage" in edit)) {
      const current = doc;
      doc = yield* canvasStep(() => editCanvas(current, canvasEditOf(edit)));
      for (const id of "update" in edit ? [edit.update] : "move" in edit ? edit.move : []) {
        changed.add(id);
      }
      continue;
    }
    if (edit.toPage === input.canvasId) {
      return yield* Effect.fail(
        new CanvasTxError("an item moved to its own page stays where it is"),
      );
    }
    const page = pages.get(edit.toPage) ?? { doc: yield* readCanvasEffect(edit.toPage), ids: [] };
    const current = doc;
    const taken = yield* canvasStep(() => takeItems(current, edit.ids));
    doc = taken.left;
    const landed = yield* canvasStep(() => landItems(page.doc, taken));
    pages.set(edit.toPage, { doc: landed, ids: [...page.ids, ...taken.nodes.map((n) => n.id)] });
    for (const carriedEdge of taken.edges) carried.add(carriedEdge.id);
  }
  const others = yield* Effect.forEach([...pages], ([page, { doc: onPage }]) =>
    canvasWithDocEffect(page, onPage),
  );
  const written = yield* commitCanvasEffect({
    canvasId: input.canvasId,
    doc,
    ...(others.length === 0 ? {} : { also: (at: string) => others.map((write) => write(at)) }),
  });
  const left = ids(doc);
  for (const page of pages.values()) for (const id of page.ids) carried.add(id);
  return {
    canvasId: input.canvasId,
    changed: [...changed].filter((id) => left.has(id)),
    deleted: [...ids(before)].filter((id) => !left.has(id) && !carried.has(id)),
    moved: [...pages].map(([page, { ids: on }]) => ({ page, ids: on })),
    lints: written.lints,
  };
});

export const EDIT_VERB: ExtensionAction = {
  id: "edit",
  title: "Edit canvas items",
  description:
    "Change items in place by id, as tldraw's updateShapes, deleteShapes, translateShapes and " +
    "moveShapesToPage do: an item's words, colour, looks, link, lock, node or size (update), a " +
    "move of items by a delta with their members (move), a delete of items and edges (delete), " +
    "or a move of items to another page where they stand (toPage). Edits are made in order as " +
    "one write, against the document as stored, and answer the lints they made and cleared. " +
    "A locked item keeps its place and size: unlock it (update with locked: false) first. " +
    "To make an item, use place (it takes the new item's id).",
  mode: { kind: "write" },
  targets: ["canvasId"],
  inputSchema: editInput,
  outputSchema: editOutput,
  effect: canvasEditEffect,
};
