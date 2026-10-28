/**
 * The canvas at the scale research D7 sets (10x the owner's tldraw board):
 * one board of 40 pages, 2,000 items on its first page, 1,000 of them
 * record cards whose nodes carry 10 fields, 200 pictures, 500 edges, and
 * drill links joining every page. The board is brought in as the owner's
 * was, by `ext.canvas.import` of a generated `.tldr`, and every operation
 * an agent or the page leans on is timed against a stated budget. The
 * budgets are four to ten times what a loaded shared machine measures,
 * so a failure is a regression of an order, not noise: `describe` took
 * 877 ms here before its near-neighbour search went through a grid. `KB_BENCH=1` prints the
 * table.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CANVAS_IDS, parseCanvasDoc, stringifyCanvasDoc, type CanvasDoc } from "@kb/canvas";
import type { ActionReceipt } from "@kb/contracts";
import { present } from "@kb/model";
import { benchmarkEnabled } from "@kb/test-kit";
import { invoke } from "../src/invoke.ts";
import { writeOut } from "../src/output.ts";
import { resetRegistryCache } from "../src/registry.ts";
import { openKb } from "../src/session.ts";

const PAGES = 40;
const FRAMES = 20;
const RECORDS = 1000;
const PLAIN = 780;
const PICTURES = 200;
const EDGES = 500;
const FIELDS = 10;
const OTHER_PAGE_SHAPES = 50;

type Kb = Awaited<ReturnType<typeof openKb>>;

const words = (text: string) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

/** A tldraw shape record. */
function shape(
  id: string,
  parentId: string,
  more: Record<string, unknown>,
): Record<string, unknown> {
  return {
    typeName: "shape",
    id: `shape:${id}`,
    parentId,
    x: 0,
    y: 0,
    index: "a1",
    meta: {},
    ...more,
  };
}

/** The tldraw id of page `p`. */
const pageId = (p: number) => `page:p${String(p)}`;

/** The board as tldraw's store records: what a `.tldr` file holds. */
function boardRecords(): unknown[] {
  const records: unknown[] = [{ typeName: "document", id: "document:document", name: "" }];
  for (let p = 0; p < PAGES; p += 1) {
    records.push({
      typeName: "page",
      id: pageId(p),
      name: `Page ${String(p)}`,
      index: `a${String(p).padStart(3, "0")}`,
    });
  }
  const first = pageId(0);
  for (let f = 0; f < FRAMES; f += 1) {
    records.push(
      shape(`frame${String(f)}`, first, {
        type: "frame",
        x: (f % 5) * 1700,
        y: Math.floor(f / 5) * 1200,
        index: `a${String(f).padStart(3, "0")}`,
        props: { w: 1600, h: 1100, name: `Lane ${String(f)}` },
        meta: { kind: "lane" },
      }),
    );
  }
  for (let r = 0; r < RECORDS; r += 1) {
    const meta: Record<string, unknown> = {
      kind: "item",
      drill: r < PAGES - 1 ? { to: pageId(r + 1) } : undefined,
    };
    for (let k = 1; k < FIELDS; k += 1)
      meta[`field${String(k)}`] = k % 3 === 0 ? r * k : `value ${String(r)}-${String(k)}`;
    records.push(
      shape(`rec${String(r)}`, `shape:frame${String(r % FRAMES)}`, {
        type: "geo",
        x: 20 + (Math.floor(r / FRAMES) % 5) * 310,
        y: 40 + Math.floor(r / (FRAMES * 5)) * 100,
        index: `b${String(r).padStart(4, "0")}`,
        props: {
          geo: "rectangle",
          w: 300,
          h: 80,
          color: "light-blue",
          richText: words(`Record ${String(r)}`),
        },
        meta,
      }),
    );
  }
  for (let s = 0; s < PLAIN; s += 1) {
    records.push(
      shape(`plain${String(s)}`, first, {
        type: s % 4 === 0 ? "text" : "geo",
        x: (s % 40) * 220,
        y: 6000 + Math.floor(s / 40) * 120,
        index: `c${String(s).padStart(4, "0")}`,
        props: { geo: "ellipse", w: 200, h: 100, richText: words(`Shape ${String(s)}`) },
      }),
    );
  }
  for (let e = 0; e < EDGES; e += 1) {
    const id = `arrow${String(e)}`;
    records.push(
      shape(id, first, {
        type: "arrow",
        index: `d${String(e).padStart(4, "0")}`,
        props: { arrowheadEnd: "arrow" },
      }),
      {
        typeName: "binding",
        id: `binding:${id}s`,
        type: "arrow",
        fromId: `shape:${id}`,
        toId: `shape:plain${String(e % PLAIN)}`,
        props: { terminal: "start" },
      },
      {
        typeName: "binding",
        id: `binding:${id}e`,
        type: "arrow",
        fromId: `shape:${id}`,
        toId: `shape:plain${String((e * 7 + 1) % PLAIN)}`,
        props: { terminal: "end" },
      },
    );
  }
  for (let p = 1; p < PAGES; p += 1) {
    records.push(
      shape(`back${String(p)}`, pageId(p), {
        type: "geo",
        isLocked: true,
        props: { w: 120, h: 30, richText: words("‹ back") },
        meta: { drill: { to: first } },
      }),
    );
    for (let s = 1; s < OTHER_PAGE_SHAPES; s += 1) {
      records.push(
        shape(`p${String(p)}s${String(s)}`, pageId(p), {
          type: "geo",
          x: (s % 10) * 220,
          y: 100 + Math.floor(s / 10) * 120,
          index: `b${String(s).padStart(3, "0")}`,
          props: { w: 200, h: 100, richText: words(`P${String(p)} ${String(s)}`) },
        }),
      );
    }
  }
  return records;
}

function output(receipt: ActionReceipt): Record<string, unknown> {
  if (receipt.status !== "succeeded") throw new Error(`${receipt.id} failed: ${receipt.message}`);
  return receipt.output as Record<string, unknown>;
}

async function timed<T>(run: () => Promise<T> | T): Promise<{ ms: number; value: T }> {
  const start = performance.now();
  const value = await run();
  return { ms: performance.now() - start, value };
}

/** Each phase's milliseconds and its budget, printed under `KB_BENCH=1`. */
const table: [string, number, number][] = [];
async function within<T>(phase: string, budget: number, run: () => Promise<T> | T): Promise<T> {
  const { ms, value } = await timed(run);
  table.push([phase, ms, budget]);
  expect(ms).toBeLessThan(budget);
  return value;
}

let root = "";
let ctx: Kb;
let board = "";
let pages: { id: string; items: number }[] = [];

const stored = (id: string): string =>
  String(
    present(
      ctx.nodes.find((n) => n.id === id),
      id,
    ).props[CANVAS_IDS.canvasField]?.[0]?.v,
  );

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "kb-canvas-scale-"));
  ctx = await openKb(root);
  await writeFile(join(root, "board.tldr"), JSON.stringify({ records: boardRecords() }));
});

afterAll(async () => {
  if (benchmarkEnabled) {
    writeOut(
      `| canvas at scale (${String(PAGES)} pages, 2,000 items, ${String(RECORDS)} records) | ms | budget |`,
    );
    writeOut("|---|---:|---:|");
    for (const [phase, ms, budget] of table)
      writeOut(`| ${phase} | ${ms.toFixed(1)} | ${String(budget)} |`);
  }
  await rm(root, { recursive: true, force: true });
  resetRegistryCache();
});

describe("the canvas at D7's scale", () => {
  test("import brings in 40 pages and 1,000 record nodes with their fields", async () => {
    const out = await within("import the .tldr (40 pages, 1,020 records)", 5_000, async () =>
      output(
        await invoke(ctx, {
          id: "ext.canvas.import",
          input: { path: "board.tldr", name: "Scale" },
        }),
      ),
    );
    board = String(out.canvasId);
    pages = (out.pages as { id: string; items: number }[]).map(({ id, items }) => ({ id, items }));
    expect(pages).toHaveLength(PAGES);
    expect(pages[0]?.items).toBe(FRAMES + RECORDS + PLAIN);
    expect(out.records).toBe(RECORDS + FRAMES);
    expect((out.fields as unknown[]).length).toBe(FIELDS);
  }, 60_000);

  test("200 pictures join the first page in one whole-document write", async () => {
    const doc = parseCanvasDoc(stored(board));
    const pictures = Array.from({ length: PICTURES }, (_, i) => ({
      id: `pic${String(i)}`,
      type: "file",
      file: `assets/scale-${String(i)}.png`,
      x: (i % 20) * 220,
      y: 9000 + Math.floor(i / 20) * 220,
      width: 200,
      height: 200,
    }));
    const next = { nodes: [...doc.nodes, ...pictures], edges: doc.edges } as CanvasDoc;
    await within("commit the whole 2,000-item page", 2_000, async () =>
      output(
        await invoke(ctx, { id: "ext.canvas.tx.apply", input: { canvasId: board, doc: next } }),
      ),
    );
    expect(parseCanvasDoc(stored(board)).nodes).toHaveLength(2000);
  }, 30_000);

  test("parse and stringify the 2,000-item page", async () => {
    const raw = stored(board);
    const doc = await within("parse the page", 150, () => parseCanvasDoc(raw));
    expect(doc.nodes).toHaveLength(2000);
    expect(doc.edges).toHaveLength(EDGES);
    const again = await within("stringify the page", 150, () => stringifyCanvasDoc(doc));
    expect(again.length).toBeGreaterThan(100_000);
  });

  test("describe answers the page and the board's 40-page drill graph", async () => {
    const out = await within("describe the page", 600, async () =>
      output(await invoke(ctx, { id: "ext.canvas.describe", input: { canvasId: board } })),
    );
    const graph = out.pages as { id: string; from: string[] }[];
    expect(graph).toHaveLength(PAGES);
    // Every other page is reached from the board and leads back to it.
    expect(graph.slice(1).every((p) => p.from.includes(board))).toBe(true);
    await within("describe a 50-item page of the board", 400, async () =>
      output(
        await invoke(ctx, {
          id: "ext.canvas.describe",
          input: { canvasId: present(pages[5], "page").id },
        }),
      ),
    );
  }, 30_000);

  test("lint reads the whole page and finds no page unreachable", async () => {
    const out = await within("lint the page", 600, async () =>
      output(await invoke(ctx, { id: "ext.canvas.lint", input: { canvasId: board } })),
    );
    const lints = out.lints as { rule: string }[];
    expect(lints.filter((l) => l.rule === "unreachable-page")).toEqual([]);
  }, 30_000);

  test("one edit on the 2,000-item page is one small change", async () => {
    await within("edit one item", 1_500, async () =>
      output(
        await invoke(ctx, {
          id: "ext.canvas.edit",
          input: {
            canvasId: board,
            edits: [
              { update: "plain3", set: { color: "red" } },
              { move: ["pic7"], by: { x: 10, y: 0 } },
            ],
          },
        }),
      ),
    );
    expect(parseCanvasDoc(stored(board)).nodes.find((n) => n.id === "plain3")?.color).toBe("1");
  }, 30_000);

  test("the store reopens with the board in it", async () => {
    const reopened = await within("reopen the store", 1_500, () => openKb(root));
    expect(
      reopened.nodes.filter((n) => n.props[CANVAS_IDS.canvasField] !== undefined),
    ).toHaveLength(PAGES);
  }, 30_000);
});
