/**
 * A canvas write is planned over the graph each commit attempt reads
 * (DESIGN.md → Canvas documents), as `node.update` is: a verb's document,
 * the node a bound edge sets its ref on, and the parent an import files its
 * board under are derived from the store as it stands when the write lands,
 * so a write another process made after this session last read the store
 * is kept, never replaced by what this session read before it. It is the
 * write path's promise, so it holds over every store backend.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { CANVAS_IDS, parseCanvasDoc, type CanvasDoc } from "@kb/canvas";
import type { ActionInvocation, ActionReceipt } from "@kb/contracts";
import { SYSTEM_IDS, fieldTypeValue, present, type KbNode } from "@kb/model";
import { invoke } from "../src/invoke.ts";
import { bunFileSystemLayer } from "../src/platform.ts";
import { resetRegistryCache } from "../src/registry.ts";
import { openKb } from "../src/session.ts";
import { STORE_BACKENDS, createStore } from "../src/store-selection.ts";

type Kb = Awaited<ReturnType<typeof openKb>>;

/** A tldraw board of one page holding one text shape. */
const BOARD = JSON.stringify({
  tldrawFileFormatVersion: 1,
  records: [
    { typeName: "document", id: "document:document", name: "" },
    { typeName: "page", id: "page:page", name: "Imported", index: "a1" },
    {
      typeName: "shape",
      id: "shape:note",
      type: "text",
      parentId: "page:page",
      index: "a1",
      x: 0,
      y: 0,
      props: { w: 200, richText: { type: "doc", content: [] } },
      meta: {},
    },
  ],
});

const card = (id: string, x: number) => ({
  id,
  type: "text",
  text: id,
  x,
  y: 0,
  width: 100,
  height: 60,
});

function succeeded(receipt: ActionReceipt): Record<string, unknown> {
  if (receipt.status !== "succeeded") throw new Error(`failed: ${receipt.message}`);
  return receipt.output as Record<string, unknown>;
}

async function run(ctx: Kb, call: Pick<ActionInvocation, "id" | "input">) {
  return succeeded(await invoke(ctx, call));
}

/** The node `id` as the store now holds it, read by a fresh session. */
async function storedNode(root: string, id: string): Promise<KbNode> {
  return present((await openKb(root)).index.getNode(id), id);
}

/** The document the store now holds on canvas `id`. */
async function storedDoc(root: string, id: string): Promise<CanvasDoc> {
  const raw = (await storedNode(root, id)).props[CANVAS_IDS.canvasField]?.[0];
  return raw === undefined ? { nodes: [], edges: [] } : parseCanvasDoc(String(raw.v));
}

const itemIds = (doc: CanvasDoc) => doc.nodes.map((n) => n.id).toSorted();

describe.each([...STORE_BACKENDS])("a canvas write over a %s store", (backend) => {
  let root: string;
  /** This session: it has read the store once, before the other process wrote. */
  let ours: Kb;
  /** Another process writing the same store. */
  let theirs: Kb;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "kb-canvas-concurrent-"));
    await Effect.runPromise(createStore(root, backend).pipe(Effect.provide(bunFileSystemLayer)));
    const seed = await openKb(root);
    await run(seed, { id: "node.add", input: { text: "Board", id: "n.canvas", tags: ["canvas"] } });
    await run(seed, { id: "node.add", input: { text: "Page", id: "n.page", tags: ["canvas"] } });
    await run(seed, { id: "node.add", input: { text: "Source", id: "n.source" } });
    await run(seed, { id: "node.add", input: { text: "Target", id: "n.target" } });
    await run(seed, { id: "node.add", input: { text: "Folder", id: "n.folder" } });
    await run(seed, { id: "field.define", input: { name: "link", id: "n.link" } });
    await run(seed, {
      id: "node.update",
      input: {
        id: "n.link",
        setProps: [{ field: SYSTEM_IDS.fieldTypeField, value: fieldTypeValue("ref") }],
      },
    });
    await run(seed, {
      id: "ext.canvas.tx.apply",
      input: {
        canvasId: "n.canvas",
        doc: {
          nodes: [
            card("a", 0),
            { ...card("from", 300), nodeId: "n.source" },
            { ...card("to", 600), nodeId: "n.target" },
          ],
          edges: [],
        },
      },
    });
    ours = await openKb(root);
    theirs = await openKb(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
    resetRegistryCache();
  });

  /** The other process puts a card `theirs` on canvas `id`, beside what it holds. */
  async function theyAddACard(id: string): Promise<void> {
    const doc = await storedDoc(root, id);
    await run(theirs, {
      id: "ext.canvas.tx.apply",
      input: { canvasId: id, doc: { ...doc, nodes: [...doc.nodes, card("theirs", 900)] } },
    });
  }

  test("a verb's document keeps an item another process placed meanwhile", async () => {
    await theyAddACard("n.canvas");
    await run(ours, {
      id: "ext.canvas.place",
      input: { canvasId: "n.canvas", items: [{ make: { id: "mine" }, near: "a", side: "south" }] },
    });
    expect(itemIds(await storedDoc(root, "n.canvas"))).toEqual(
      ["a", "from", "mine", "theirs", "to"].toSorted(),
    );
  });

  test("a move to another page keeps what the other process put on that page", async () => {
    await theyAddACard("n.page");
    await run(ours, {
      id: "ext.canvas.edit",
      input: { canvasId: "n.canvas", edits: [{ ids: ["a"], toPage: "n.page" }] },
    });
    expect(itemIds(await storedDoc(root, "n.page"))).toEqual(["a", "theirs"]);
  });

  test("a bound edge keeps the source node's concurrent edit", async () => {
    await run(theirs, { id: "node.update", input: { id: "n.source", text: "Renamed" } });
    await run(ours, {
      id: "ext.canvas.connect",
      input: { canvasId: "n.canvas", from: "from", to: "to", bind: "n.link" },
    });
    const source = await storedNode(root, "n.source");
    expect(source.text).toBe("Renamed");
    expect(source.props["n.link"]).toEqual([{ t: "ref", v: "n.target" }]);
  });

  test("a canvas transaction's prop write keeps the node's concurrent edit", async () => {
    await run(theirs, { id: "node.update", input: { id: "n.source", text: "Renamed" } });
    const doc = await storedDoc(root, "n.canvas");
    await run(ours, {
      id: "ext.canvas.tx.apply",
      input: {
        canvasId: "n.canvas",
        doc,
        propTargetId: "n.source",
        setProps: [{ field: "n.link", value: { t: "ref", v: "n.target" } }],
      },
    });
    const source = await storedNode(root, "n.source");
    expect(source.text).toBe("Renamed");
    expect(source.props["n.link"]).toEqual([{ t: "ref", v: "n.target" }]);
  });

  test("an import keeps a child another process filed under its parent meanwhile", async () => {
    await run(theirs, {
      id: "node.add",
      input: { text: "Their child", id: "n.their-child", parent: "n.folder" },
    });
    await writeFile(join(root, "board.tldr"), BOARD);
    const out = await run(ours, {
      id: "ext.canvas.import",
      input: { path: "board.tldr", parent: "n.folder" },
    });
    const folder = await storedNode(root, "n.folder");
    expect(folder.children).toEqual(["n.their-child", String(out["canvasId"])]);
  });
});
