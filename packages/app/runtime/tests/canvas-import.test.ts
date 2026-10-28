/**
 * `ext.canvas.import` through the invoke core: a tldraw file, `.tldr` JSON
 * or a `.tldraw` archive holding tldraw-sync's `db.sqlite`, written as one
 * transaction: the board and its pages as `#canvas` nodes, each record
 * card's node under its page with its meta keys as fields (made when kb
 * has none of the name it can write in), and a drill as a link between pages. The pure
 * lowering is `@kb/canvas`'s `tldraw.test.ts`.
 */
import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateRawSync } from "node:zlib";
import { CANVAS_IDS, parseCanvasDoc, type CanvasDoc } from "@kb/canvas";
import type { ActionReceipt } from "@kb/contracts";
import { SYSTEM_IDS, fieldTypeValue, present } from "@kb/model";
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

async function freshKb(): Promise<{ ctx: Kb; root: string }> {
  const root = await mkdtemp(join(tmpdir(), "kb-canvas-import-"));
  roots.push(root);
  return { ctx: await openKb(root), root };
}

const words = (text: string) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

/** A board of two pages: a lane holding a record card and a drill badge to the second page, which leads back. */
const RECORDS = [
  { typeName: "document", id: "document:document", name: "" },
  { typeName: "page", id: "page:page", name: "Overview", index: "a1" },
  { typeName: "page", id: "page:gaps", name: "Overview / Gaps", index: "a2" },
  {
    typeName: "shape",
    id: "shape:lane",
    type: "frame",
    parentId: "page:page",
    index: "a1",
    x: 0,
    y: 0,
    props: { w: 600, h: 300, name: "Decide" },
    meta: {},
  },
  {
    typeName: "shape",
    id: "shape:item",
    type: "geo",
    parentId: "shape:lane",
    index: "a1",
    x: 20,
    y: 40,
    props: {
      geo: "rectangle",
      w: 300,
      h: 80,
      color: "light-red",
      richText: words("Fix the relay"),
    },
    meta: { kind: "item", pri: "H", open: true, n: 2 },
  },
  {
    typeName: "shape",
    id: "shape:badge",
    type: "geo",
    parentId: "shape:lane",
    index: "a2",
    x: 560,
    y: 10,
    isLocked: true,
    props: { geo: "ellipse", w: 24, h: 24, richText: words("↘") },
    meta: { drill: { to: "page:gaps", focus: "shape:back" } },
  },
  {
    typeName: "shape",
    id: "shape:back",
    type: "geo",
    parentId: "page:gaps",
    index: "a1",
    x: 0,
    y: 0,
    isLocked: true,
    props: { geo: "rectangle", w: 120, h: 30, richText: words("‹ Overview") },
    meta: { drill: { to: "page:page" } },
  },
  {
    typeName: "shape",
    id: "shape:pen",
    type: "draw",
    parentId: "page:gaps",
    index: "a2",
    props: {},
    meta: {},
  },
];

/** A ZIP holding `entries`, each deflated, as a `.tldraw` archive is. */
function zip(entries: Record<string, Uint8Array>): Uint8Array {
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  const encoder = new TextEncoder();
  for (const [name, data] of Object.entries(entries)) {
    const packed = deflateRawSync(data);
    const nameBytes = encoder.encode(name);
    const crc = Bun.hash.crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(8, 8, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, packed.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, nameBytes.length, true);
    const central = new DataView(new ArrayBuffer(46));
    central.setUint32(0, 0x02014b50, true);
    central.setUint16(10, 8, true);
    central.setUint32(16, crc, true);
    central.setUint32(20, packed.length, true);
    central.setUint32(24, data.length, true);
    central.setUint16(28, nameBytes.length, true);
    central.setUint32(42, offset, true);
    locals.push(new Uint8Array(local.buffer), nameBytes, packed);
    centrals.push(new Uint8Array(central.buffer), nameBytes);
    offset += 30 + nameBytes.length + packed.length;
  }
  const size = centrals.reduce((sum, part) => sum + part.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, Object.keys(entries).length, true);
  end.setUint16(10, Object.keys(entries).length, true);
  end.setUint32(12, size, true);
  end.setUint32(16, offset, true);
  return Buffer.concat([...locals, ...centrals, new Uint8Array(end.buffer)]);
}

/** tldraw-sync's storage of `records`: a `documents` table keeping each record's JSON in `state`. */
function syncDb(records: readonly unknown[]): Uint8Array {
  const db = new Database(":memory:");
  db.run(
    "create table documents (id text primary key, state blob not null, lastChangedClock integer)",
  );
  const insert = db.prepare("insert into documents values (?, ?, 0)");
  for (const record of records) {
    insert.run((record as { id: string }).id, new TextEncoder().encode(JSON.stringify(record)));
  }
  const bytes = db.serialize();
  db.close();
  return bytes;
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

interface Imported {
  canvasId: string;
  pages: { id: string; name: string; items: number; edges: number }[];
  fields: { name: string; field: string; id: string; made: boolean; type: string }[];
}

describe("ext.canvas.import", () => {
  test("a .tldraw archive becomes a board with its pages, record nodes, fields and drill links", async () => {
    const { ctx, root } = await freshKb();
    await invoke(ctx, { id: "field.define", input: { name: "pri", id: "f.pri" } });
    await writeFile(join(root, "board.tldraw"), zip({ "db.sqlite": syncDb(RECORDS) }));
    const out = output(
      await invoke(ctx, {
        id: "ext.canvas.import",
        input: { path: "board.tldraw", name: "Outstanding" },
      }),
    );
    expect(out).toMatchObject({ records: 1, reported: ["1 draw shape: not drawn"] });
    const { canvasId, pages, fields } = out as unknown as Imported;
    expect(pages.map((p) => [p.name, p.items])).toEqual([
      ["Overview", 3],
      ["Overview / Gaps", 1],
    ]);
    const gaps = present(pages[1], "the second page").id;
    const board = present(
      ctx.nodes.find((n) => n.id === canvasId),
      "board",
    );
    expect(board.text).toBe("Outstanding");
    expect(board.children).toContain(gaps);
    // The existing field is used; the others are made, typed by their values.
    expect(fields.map((f) => [f.name, f.made, f.type])).toEqual([
      ["kind", true, "text"],
      ["pri", false, "text"],
      ["open", true, "checkbox"],
      ["n", true, "number"],
    ]);
    expect(fields.find((f) => f.name === "pri")?.id).toBe("f.pri");

    const doc = stored(ctx, canvasId);
    const item = present(
      doc.nodes.find((n) => n.id === "item"),
      "item",
    );
    expect(item).toMatchObject({ type: "kb-node", parent: "lane", x: 20, y: 40, color: "pink" });
    const record = present(
      ctx.nodes.find((n) => n.id === (item as { nodeId: string }).nodeId),
      "record",
    );
    expect(record.text).toBe("Fix the relay");
    expect(board.children).toContain(record.id);
    const field = (name: string) =>
      present(
        fields.find((f) => f.name === name),
        name,
      ).id;
    expect(record.props[field("pri")]).toEqual([{ t: "str", v: "H" }]);
    expect(record.props[field("open")]).toEqual([{ t: "bool", v: true }]);
    expect(record.props[field("n")]).toEqual([{ t: "num", v: 2 }]);
    expect(doc.nodes.find((n) => n.id === "badge")).toMatchObject({
      locked: true,
      link: { node: gaps, item: "back" },
    });
    expect(stored(ctx, gaps).nodes).toEqual([
      expect.objectContaining({ id: "back", link: { node: canvasId } }),
    ]);

    // The drill is a page the board reaches.
    const described = output(await invoke(ctx, { id: "ext.canvas.describe", input: { canvasId } }));
    expect(described.pages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: gaps, links: [{ item: "back", to: canvasId }] }),
      ]),
    );
  });

  test("a .tldr file is read as JSON, and anything else is refused with nothing written", async () => {
    const { ctx, root } = await freshKb();
    await writeFile(
      join(root, "board.tldr"),
      JSON.stringify({ tldrawFileFormatVersion: 1, records: RECORDS }),
    );
    const out = output(
      await invoke(ctx, { id: "ext.canvas.import", input: { path: join(root, "board.tldr") } }),
    );
    expect(
      present(
        ctx.nodes.find((n) => n.id === out.canvasId),
        "board",
      ).text,
    ).toBe("Overview");

    const before = ctx.nodes.length;
    await writeFile(join(root, "not.tldr"), "{}");
    const refused = await invoke(ctx, { id: "ext.canvas.import", input: { path: "not.tldr" } });
    expect(refused.status).toBe("failed");
    expect(refused.status === "failed" ? refused.message : "").toMatch(/holds records/);
    const archive = await invoke(ctx, { id: "ext.canvas.import", input: { path: "x.tldraw" } });
    expect(archive.status).toBe("failed");
    await writeFile(join(root, "empty.tldraw"), zip({ "other.txt": new Uint8Array([1]) }));
    const empty = await invoke(ctx, { id: "ext.canvas.import", input: { path: "empty.tldraw" } });
    expect(empty.status === "failed" ? empty.message : "").toMatch(/db\.sqlite/);
    expect(ctx.nodes.length).toBe(before);
  });

  test("a meta key kb's field of that name cannot take is the board's own field, joined on a second import", async () => {
    const { ctx, root } = await freshKb();
    // pri: one field, of a type "H" is not. kind: two fields of that name. type: kb's own.
    await invoke(ctx, { id: "field.define", input: { name: "pri", id: "f.pri" } });
    await invoke(ctx, {
      id: "node.update",
      input: {
        id: "f.pri",
        setProps: [{ field: SYSTEM_IDS.fieldTypeField, value: fieldTypeValue("number") }],
      },
    });
    await invoke(ctx, { id: "field.define", input: { name: "kind", id: "f.kind1" } });
    await invoke(ctx, { id: "field.define", input: { name: "kind", id: "f.kind2" } });
    const meta = { kind: "item", pri: "H", type: "x", open: true };
    const keyed = RECORDS.map((r) => (r.id === "shape:item" ? { ...r, meta } : r));
    await writeFile(join(root, "b.tldr"), JSON.stringify({ records: keyed }));
    const imported = async () =>
      (
        output(
          await invoke(ctx, { id: "ext.canvas.import", input: { path: "b.tldr" } }),
        ) as unknown as Imported
      ).fields;

    const first = await imported();
    expect(first.map((f) => [f.name, f.field, f.made])).toEqual([
      ["kind", "kind (Overview)", true],
      ["pri", "pri (Overview)", true],
      ["type", "type (Overview)", true],
      ["open", "open", true],
    ]);
    expect(first.map((f) => f.id)).not.toContain("f.pri");
    // Imported again, the board writes in the fields it made, and makes none.
    const second = await imported();
    expect(second.map((f) => [f.field, f.id, f.made])).toEqual(
      first.map((f) => [f.field, f.id, false]),
    );
  });
});
