/**
 * A tldraw board lowered to kb's canvas (`tldraw.ts`): pages in order,
 * frames as frames with their members on the canvas's coordinates, a card
 * carrying meta as a record node shown by a card, a drill as a link to a
 * page, looks as kb's nearest, bound arrows as edges, and what kb does not
 * draw reported.
 */
import { describe, expect, test } from "bun:test";
import { isKbNode, tldrawBoard, tldrawKeys, tldrawText, type TldrawPage } from "../src/index.ts";

const rich = (...paragraphs: unknown[][]) => ({
  type: "doc",
  content: paragraphs.map((content) => ({ type: "paragraph", content })),
});
const run = (text: string, ...marks: unknown[]) => ({ type: "text", text, marks });
const shape = (id: string, parentId: string, type: string, more: Record<string, unknown>) => ({
  typeName: "shape",
  id: `shape:${id}`,
  parentId,
  type,
  x: 0,
  y: 0,
  rotation: 0,
  opacity: 1,
  isLocked: false,
  index: "a1",
  meta: {},
  ...more,
});

/** Two pages (listed out of order), a frame holding a record card, a drill badge, a back badge, arrows. */
const records = [
  { typeName: "document", id: "document:document", name: "" },
  { typeName: "page", id: "page:gaps", name: "Overview / Gaps", index: "a2" },
  { typeName: "page", id: "page:root", name: "Overview", index: "a1" },
  shape("lane", "page:root", "frame", {
    x: 100,
    y: 50,
    meta: { kind: "lane" },
    props: { w: 400, h: 300, name: "Decide (1)" },
  }),
  shape("card", "shape:lane", "geo", {
    x: 20,
    y: 30,
    index: "a1",
    meta: { kind: "item", pri: "H", nodeIds: ["n1", "n2"], area: null, stale: false, n: 3 },
    props: {
      geo: "rectangle",
      w: 300,
      h: 80,
      growY: 20,
      color: "light-blue",
      fill: "solid",
      dash: "dashed",
      size: "s",
      font: "draw",
      align: "start",
      verticalAlign: "start",
      url: "",
      richText: rich(
        [run("Tailscale direct path", { type: "bold" })],
        [
          run("see "),
          run("kb#41", { type: "link", attrs: { href: "https://github.com/popemkt/kb/pull/41" } }),
        ],
      ),
    },
  }),
  shape("drill", "shape:lane", "geo", {
    x: 290,
    y: 30,
    index: "a2",
    isLocked: true,
    meta: { drill: { to: "page:gaps", focus: "shape:back" } },
    props: { geo: "ellipse", w: 24, h: 24, color: "black", richText: rich([run("↘")]) },
  }),
  shape("back", "page:gaps", "geo", {
    isLocked: true,
    meta: { drill: { to: "page:root" } },
    props: {
      geo: "rectangle",
      w: 120,
      h: 30,
      color: "grey",
      url: "https://kb.test/doc",
      richText: rich([run("‹ Overview")]),
    },
  }),
  shape("title", "page:gaps", "text", {
    x: 0,
    y: 100,
    props: { size: "l", w: 8, autoSize: true, richText: rich([run("Gaps")]) },
  }),
  shape("a", "page:gaps", "geo", { x: 0, y: 300, props: { geo: "heart", w: 100, h: 100 } }),
  shape("b", "page:gaps", "geo", {
    x: 400,
    y: 300,
    index: "a3",
    props: { geo: "rectangle", w: 100, h: 100 },
  }),
  shape("ab", "page:gaps", "arrow", {
    index: "a4",
    props: {
      start: { x: 100, y: 350 },
      end: { x: 400, y: 350 },
      bend: 0,
      arrowheadStart: "none",
      arrowheadEnd: "dot",
      richText: rich([run("feeds")]),
    },
  }),
  shape("loose", "page:gaps", "arrow", {
    x: 10,
    y: 10,
    index: "a5",
    props: { start: { x: 0, y: 0 }, end: { x: 50, y: 20 }, arrowheadEnd: "arrow" },
  }),
  shape("scribble", "page:gaps", "draw", { index: "a6", props: {} }),
  {
    typeName: "binding",
    id: "binding:1",
    type: "arrow",
    fromId: "shape:ab",
    toId: "shape:a",
    props: { terminal: "start", normalizedAnchor: { x: 1, y: 0.5 } },
  },
  {
    typeName: "binding",
    id: "binding:2",
    type: "arrow",
    fromId: "shape:ab",
    toId: "shape:b",
    props: { terminal: "end", normalizedAnchor: { x: 0, y: 0.5 } },
  },
  {
    typeName: "binding",
    id: "binding:3",
    type: "arrow",
    fromId: "shape:loose",
    toId: "shape:a",
    props: { terminal: "start" },
  },
];

/** The item `id` on `page`. */
const item = (page: TldrawPage | undefined, id: string) => page?.doc.nodes.find((n) => n.id === id);

const ids = { page: (key: string) => `node:${key}`, record: (key: string) => `node:${key}` };

describe("tldrawBoard", () => {
  const board = tldrawBoard(records, ids);
  const [root, gaps] = board.pages;

  test("its pages are in tldraw's page order; the keys a write needs ids for are the same", () => {
    expect(board.pages.map((p) => [p.key, p.name])).toEqual([
      ["page:root", "Overview"],
      ["page:gaps", "Overview / Gaps"],
    ]);
    expect(tldrawKeys(records)).toEqual({
      pages: ["page:root", "page:gaps"],
      records: ["shape:lane", "shape:card"],
    });
  });

  test("a frame is a frame, and its members stand on the canvas's coordinates, inside it", () => {
    expect(item(root, "lane")).toMatchObject({
      type: "group",
      label: "Decide (1)",
      x: 100,
      y: 50,
      nodeId: "node:shape:lane",
    });
    expect(item(root, "card")).toMatchObject({
      x: 120,
      y: 80,
      width: 300,
      height: 100,
      parent: "lane",
    });
    expect(root?.doc.nodes.map((n) => n.id)).toEqual(["lane", "card", "drill"]);
  });

  test("a card carrying meta is a record: a node with its words as markdown and its keys as fields", () => {
    const card = item(root, "card");
    expect(card !== undefined && isKbNode(card) ? card.nodeId : null).toBe("node:shape:card");
    expect(card).toMatchObject({
      color: "cyan",
      style: { fill: "solid", dash: "dashed", size: "s" },
    });
    const record = board.records.find((r) => r.key === "shape:card");
    expect(record).toEqual({
      key: "shape:card",
      page: "page:root",
      text: "**Tailscale direct path**\nsee [kb#41](https://github.com/popemkt/kb/pull/41)",
      fields: [
        { name: "kind", values: ["item"] },
        { name: "pri", values: ["H"] },
        { name: "nodeIds", values: ["n1", "n2"] },
        { name: "stale", values: [false] },
        { name: "n", values: [3] },
      ],
    });
  });

  test("a drill is a link to its page and the item shown there, and a locked badge is a control", () => {
    expect(item(root, "drill")).toMatchObject({
      type: "shape",
      shape: "ellipse",
      label: "↘",
      locked: true,
      link: { node: "node:page:gaps", item: "back" },
    });
    // meta.drill alone is navigation, not a record; the drill wins over the url.
    expect(item(gaps, "back")).toMatchObject({
      locked: true,
      link: { node: "node:page:root" },
      color: "grey",
    });
    expect(item(gaps, "back")?.nodeId).toBeUndefined();
  });

  test("text has no outline or ground, and is sized from its words", () => {
    const title = item(gaps, "title");
    expect(title).toMatchObject({
      type: "text",
      text: "Gaps",
      style: { fill: "none", dash: "none", size: "l" },
    });
    expect(title?.width).toBeGreaterThan(8);
  });

  test("an arrow bound at both ends is an edge; one that is not is a line; what kb lacks is reported", () => {
    expect(gaps?.doc.edges).toEqual([
      expect.objectContaining({
        id: "ab",
        fromNode: "a",
        toNode: "b",
        label: "feeds",
        route: "straight",
        fromAnchor: { x: 1, y: 0.5 },
        toHead: "dot",
      }),
    ]);
    expect(item(gaps, "loose")).toMatchObject({ type: "path", x: 10, y: 10, toHead: "arrow" });
    expect(board.reported).toEqual([
      "shape:a: a heart is drawn as a rect",
      "shape:loose: an arrow not bound at both ends is drawn as a line",
      "1 draw shape: not drawn",
    ]);
  });
});

describe("tldrawText", () => {
  test("says rich text as markdown or plain, a list item as a dash line, and plain text as itself", () => {
    const list = {
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [{ type: "paragraph", content: [run("one", { type: "italic" })] }],
            },
          ],
        },
      ],
    };
    expect(tldrawText(list, "markdown")).toBe("- *one*");
    expect(tldrawText(list, "plain")).toBe("- one");
    expect(tldrawText("as written", "markdown")).toBe("as written");
    expect(tldrawText(42, "plain")).toBe("");
  });
});
