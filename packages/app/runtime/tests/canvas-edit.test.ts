/**
 * `ext.canvas.edit` through the invoke core: changes by id, made in order
 * against the stored document as one canvas write whose receipt carries
 * the lints it made and cleared; a move to another page writes both pages
 * in one transaction. The pure halves are `@kb/canvas`'s `edit.test.ts`.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CANVAS_IDS, parseCanvasDoc, type CanvasDoc } from "@kb/canvas";
import type { ActionReceipt } from "@kb/contracts";
import { present } from "@kb/model";
import { invoke } from "../src/invoke.ts";
import { resetRegistryCache } from "../src/registry.ts";
import { openKb } from "../src/session.ts";

type Kb = Awaited<ReturnType<typeof openKb>>;

let roots: string[] = [];
afterEach(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
  roots = [];
  resetRegistryCache();
});

const card = (id: string, x: number, more: Record<string, unknown> = {}) => ({
  id,
  type: "text",
  text: id,
  x,
  y: 0,
  width: 100,
  height: 60,
  ...more,
});

/** A fresh kb with a board `n.board` holding `items` and `edges`, and its page `n.page`. */
async function boardKb(
  items: Record<string, unknown>[],
  edges: Record<string, unknown>[] = [],
): Promise<Kb> {
  const root = await mkdtemp(join(tmpdir(), "kb-canvas-edit-"));
  roots.push(root);
  const ctx = await openKb(root);
  await invoke(ctx, { id: "node.add", input: { text: "Board", id: "n.board", tags: ["canvas"] } });
  await invoke(ctx, {
    id: "node.add",
    input: { text: "Board / Page", id: "n.page", tags: ["canvas"], parent: "n.board" },
  });
  const applied = await invoke(ctx, {
    id: "ext.canvas.tx.apply",
    input: { canvasId: "n.board", doc: { nodes: items, edges } },
  });
  expect(applied.status).toBe("succeeded");
  return ctx;
}

function stored(ctx: Kb, id: string): CanvasDoc {
  const node = present(
    ctx.nodes.find((n) => n.id === id),
    id,
  );
  const raw = node.props[CANVAS_IDS.canvasField]?.[0];
  return raw === undefined ? { nodes: [], edges: [] } : parseCanvasDoc(String(raw.v));
}

function output(receipt: ActionReceipt): Record<string, unknown> {
  if (receipt.status !== "succeeded") throw new Error(`failed: ${receipt.message}`);
  return receipt.output as Record<string, unknown>;
}

const edit = (edits: unknown[], canvasId = "n.board") => ({
  id: "ext.canvas.edit",
  input: { canvasId, edits },
});

describe("ext.canvas.edit", () => {
  test("updates, moves and deletes by id in one write, and answers its lints", async () => {
    const ctx = await boardKb(
      [card("a", 0), card("b", 300), card("c", 600)],
      [{ id: "ab", fromNode: "a", toNode: "b" }],
    );
    const out = output(
      await invoke(
        ctx,
        edit([
          { update: "a", set: { text: "Decide", color: "red", link: { item: "gone" } } },
          { move: ["b"], by: { x: 0, y: 200 } },
          { delete: ["c"] },
        ]),
      ),
    );
    expect(out).toMatchObject({ changed: ["a", "b"], deleted: ["c"], moved: [] });
    expect(out.lints).toMatchObject({ new: [{ rule: "dead-link", ids: ["a"] }] });
    const doc = stored(ctx, "n.board");
    expect(doc.nodes.map((n) => [n.id, n.y])).toEqual([
      ["a", 0],
      ["b", 200],
    ]);
    expect(doc.nodes[0]).toMatchObject({ text: "Decide", color: "1", link: { item: "gone" } });
    expect(doc.edges.map((e) => e.id)).toEqual(["ab"]);
  });

  test("a refused edit writes nothing, and a locked item names how to unlock it", async () => {
    const ctx = await boardKb([card("a", 0, { locked: true }), card("b", 300)]);
    const refused = await invoke(
      ctx,
      edit([{ update: "b", set: { text: "lost" } }, { delete: ["a"] }]),
    );
    expect(refused.status).toBe("failed");
    expect(refused.status === "failed" ? refused.message : "").toMatch(
      /a is locked; unlock it \(edit with locked: false\)/,
    );
    expect(stored(ctx, "n.board").nodes.map((n) => "text" in n && n.text)).toEqual(["a", "b"]);
    // Unlocking and deleting in one call is two edits in order.
    output(await invoke(ctx, edit([{ update: "a", set: { locked: false } }, { delete: ["a"] }])));
    expect(stored(ctx, "n.board").nodes.map((n) => n.id)).toEqual(["b"]);
  });

  test("toPage carries items with their members and the edges among them to another page", async () => {
    const ctx = await boardKb(
      [
        { id: "f", type: "group", label: "Gaps", x: 0, y: 0, width: 400, height: 200 },
        card("a", 20, { parent: "f" }),
        card("b", 200, { parent: "f" }),
        card("c", 600),
      ],
      [
        { id: "ab", fromNode: "a", toNode: "b" },
        { id: "bc", fromNode: "b", toNode: "c" },
      ],
    );
    const out = output(await invoke(ctx, edit([{ toPage: "n.page", ids: ["f"] }])));
    expect(out).toMatchObject({
      moved: [{ page: "n.page", ids: ["f", "a", "b"] }],
      deleted: ["bc"],
    });
    expect(stored(ctx, "n.board")).toMatchObject({ nodes: [{ id: "c" }], edges: [] });
    const page = stored(ctx, "n.page");
    expect(page.nodes.map((n) => [n.id, n.parent])).toEqual([
      ["f", undefined],
      ["a", "f"],
      ["b", "f"],
    ]);
    expect(page.edges.map((e) => e.id)).toEqual(["ab"]);
    const self = await invoke(ctx, edit([{ toPage: "n.board", ids: ["c"] }]));
    expect(self.status).toBe("failed");
  });
});
