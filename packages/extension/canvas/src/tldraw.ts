/**
 * A tldraw board lowered to kb's canvas (DESIGN.md → Canvas documents →
 * Import): one way, every record becoming something kb already has, and
 * what has no counterpart named in `reported`. kb never keeps tldraw's
 * format. The records are tldraw's store records, as a `.tldr` file's
 * `records` and a `.tldraw` file's `documents` table hold them; reading
 * the file is the server entry's.
 *
 * - The first page (by its `index`) is the board, the others its pages.
 * - A `frame` is a `group` named by its `name`; a tldraw `group` is no item
 *   (its members stand where they stand); a child's coordinates, relative
 *   to its parent, become the canvas's.
 * - A `geo` is a `shape`, a `text` a text item with no outline or ground, a
 *   `note` a text card in its colour, an `arrow` bound at both ends an edge
 *   and otherwise a line.
 * - A shape carrying `meta` is a record: it stands for a node (`nodeId`)
 *   whose text is its rich text as markdown and whose fields are its meta
 *   keys, and it is drawn as a card showing that node. `meta.drill`
 *   (`{to, focus?}`, the owner's drill-down convention) is the item's link.
 * - colour, fill, dash, size, font and alignment are kb's nearest looks;
 *   `isLocked` is `locked`; `url`, or a lone link mark, is the item's link.
 */
import type { NodeId } from "@kb/model";
import type { CanvasDoc, CanvasEdge, CanvasHead, CanvasNode, CanvasShapeKind } from "./doc.ts";
import { withEnd, withHead } from "./edges.ts";
import { isRecord } from "./fields.ts";
import { isLinkUrl, type CanvasItemLink } from "./links.ts";
import type { CanvasLooksPatch } from "./style.ts";
import { withStyle } from "./style.ts";

/** A tldraw store record, as far as the lowering reads one; what it does not check is `unknown`. */
interface TlRecord {
  readonly id: string;
  readonly typeName: string;
  readonly type: string | undefined;
  readonly name: string | undefined;
  readonly index: string | undefined;
  readonly parentId: string | undefined;
  readonly x: unknown;
  readonly y: unknown;
  readonly rotation: unknown;
  readonly opacity: unknown;
  readonly isLocked: boolean;
  readonly props: Record<string, unknown> | undefined;
  readonly meta: Record<string, unknown> | undefined;
  readonly fromId: string | undefined;
  readonly toId: string | undefined;
}

const str = (v: unknown) => (typeof v === "string" ? v : undefined);

/** `raw` read as a store record, or undefined when it has no id or type name. */
function asRecord(raw: unknown): TlRecord | undefined {
  if (!isRecord(raw) || typeof raw.id !== "string" || typeof raw.typeName !== "string") {
    return undefined;
  }
  return {
    id: raw.id,
    typeName: raw.typeName,
    type: str(raw.type),
    name: str(raw.name),
    index: str(raw.index),
    parentId: str(raw.parentId),
    x: raw.x,
    y: raw.y,
    rotation: raw.rotation,
    opacity: raw.opacity,
    isLocked: raw.isLocked === true,
    props: isRecord(raw.props) ? raw.props : undefined,
    meta: isRecord(raw.meta) ? raw.meta : undefined,
    fromId: str(raw.fromId),
    toId: str(raw.toId),
  };
}

/** A field value a record writes: words, a number or a truth. */
export type TldrawValue = string | number | boolean;

/** A record node an imported card stands for: its words as markdown, and its meta keys as fields. */
export interface TldrawRecordNode {
  /** The shape it came from. */
  readonly key: string;
  /** The page it is on. */
  readonly page: string;
  readonly text: string;
  readonly fields: readonly { readonly name: string; readonly values: readonly TldrawValue[] }[];
}

export interface TldrawPage {
  /** The tldraw page record's id. */
  readonly key: string;
  readonly name: string;
  readonly doc: CanvasDoc;
}

export interface TldrawBoard {
  /** The board first, then its pages, in tldraw's page order. */
  readonly pages: readonly TldrawPage[];
  readonly records: readonly TldrawRecordNode[];
  /** What kb drew differently, or not at all, in words, one line each. */
  readonly reported: readonly string[];
}

/** The node ids a lowering writes: one per page, one per record shape. */
export interface TldrawIds {
  readonly page: (key: string) => NodeId;
  readonly record: (key: string) => NodeId;
}

/** The meta keys a record reads as navigation, not as fields. */
const NAVIGATION_KEYS: ReadonlySet<string> = new Set(["drill"]);

/** Whether `shape` carries a record: any meta key beyond navigation. */
function carriesRecord(shape: TlRecord): boolean {
  return Object.entries(shape.meta ?? {}).some(
    ([key, value]) => !NAVIGATION_KEYS.has(key) && valuesOf(value).length > 0,
  );
}

const byIndex = (a: TlRecord, b: TlRecord) => {
  const [x, y] = [a.index ?? "", b.index ?? ""];
  if (x === y) return a.id < b.id ? -1 : 1;
  return x < y ? -1 : 1;
};

/** The page and record keys `raw` holds: what a lowering needs ids for, in page order. */
export function tldrawKeys(raw: readonly unknown[]): { pages: string[]; records: string[] } {
  const records = raw.flatMap((r) => asRecord(r) ?? []);
  return {
    pages: records
      .filter((r) => r.typeName === "page")
      .toSorted(byIndex)
      .map((p) => p.id),
    records: records.filter((r) => r.typeName === "shape" && carriesRecord(r)).map((s) => s.id),
  };
}

/** An item id from a tldraw id: its own name, without the `shape:` prefix. */
const itemIdOf = (key: string) => key.replace(/^shape:/, "");

// ── rich text ───────────────────────────────────────────────────────────

interface TipTapNode {
  readonly type?: string;
  readonly text?: string;
  readonly content?: readonly TipTapNode[];
  readonly marks?: readonly {
    readonly type?: string;
    readonly attrs?: { readonly href?: unknown };
  }[];
}

/** A shape's words as tldraw writes them: rich text (TipTap's JSON), or plain `text` before it. */
function wordsOf(props: Record<string, unknown>): TipTapNode | string {
  if (isRecord(props.richText)) return props.richText;
  return typeof props.text === "string" ? props.text : "";
}

/** One run of text as markdown: bold, italic, code and a link, as kb's node text writes them. */
function markedRun(node: TipTapNode): string {
  let text = node.text ?? "";
  if (text.trim() === "") return text;
  for (const mark of node.marks ?? []) {
    if (mark.type === "bold") text = `**${text}**`;
    else if (mark.type === "italic") text = `*${text}*`;
    else if (mark.type === "code") text = `\`${text}\``;
  }
  const href = node.marks?.find((mark) => mark.type === "link")?.attrs?.href;
  return typeof href === "string" && isLinkUrl(href) ? `[${text}](${href})` : text;
}

/** `doc`'s blocks as lines, each run said by `run`; a list item is a `- ` line. */
function blockLines(doc: TipTapNode, run: (node: TipTapNode) => string, bullet = ""): string[] {
  if (doc.type === "text") return [run(doc)];
  const children = doc.content ?? [];
  if (doc.type === "paragraph" || doc.type === "heading") {
    return [bullet + children.map((child) => (child.type === "text" ? run(child) : "")).join("")];
  }
  if (doc.type === "listItem") return children.flatMap((child) => blockLines(child, run, "- "));
  return children.flatMap((child) => blockLines(child, run, bullet));
}

/** A shape's words as markdown (a record node's text) or plain (an item's own words). */
export function tldrawText(words: unknown, as: "markdown" | "plain"): string {
  const rich = isRecord(words) ? (words as TipTapNode) : words;
  if (typeof rich === "string") return rich;
  if (!isRecord(rich)) return "";
  const run = as === "markdown" ? markedRun : (node: TipTapNode) => node.text ?? "";
  return blockLines(rich, run).join("\n").trim();
}

/** `node` and every node within it, in order. */
const runs = (node: TipTapNode): TipTapNode[] => [node, ...(node.content ?? []).flatMap(runs)];

/** The web addresses a shape's words link to, in order. */
function linkMarks(words: TipTapNode | string): string[] {
  if (typeof words === "string") return [];
  return runs(words).flatMap((node) =>
    (node.marks ?? []).flatMap((mark) =>
      mark.type === "link" && typeof mark.attrs?.href === "string" && isLinkUrl(mark.attrs.href)
        ? [mark.attrs.href]
        : [],
    ),
  );
}

// ── looks ───────────────────────────────────────────────────────────────

/** tldraw's colours as kb's palette names; black and white are the ink and ground kb draws by default. */
const COLORS: Readonly<Record<string, string | null>> = {
  black: null,
  white: null,
  grey: "grey",
  "light-violet": "purple",
  violet: "purple",
  blue: "blue",
  "light-blue": "cyan",
  yellow: "yellow",
  orange: "orange",
  green: "green",
  "light-green": "green",
  "light-red": "pink",
  red: "red",
};

const FILLS: Readonly<Record<string, NonNullable<CanvasLooksPatch["fill"]>>> = {
  none: "none",
  semi: "semi",
  solid: "solid",
  fill: "solid",
  pattern: "semi",
  "lined-fill": "semi",
};
const DASHES: Readonly<Record<string, NonNullable<CanvasLooksPatch["dash"]>>> = {
  draw: "solid",
  solid: "solid",
  dashed: "dashed",
  dotted: "dotted",
};
const SIZES: Readonly<Record<string, NonNullable<CanvasLooksPatch["size"]>>> = {
  s: "s",
  m: "m",
  l: "l",
  xl: "xl",
};
const FONTS: Readonly<Record<string, NonNullable<CanvasLooksPatch["font"]>>> = {
  draw: "sans",
  sans: "sans",
  serif: "serif",
  mono: "mono",
};
const ALIGNS: Readonly<Record<string, NonNullable<CanvasLooksPatch["align"]>>> = {
  start: "start",
  middle: "middle",
  end: "end",
  "start-legacy": "start",
  "middle-legacy": "middle",
  "end-legacy": "end",
};
const VALIGNS: Readonly<Record<string, NonNullable<CanvasLooksPatch["valign"]>>> = {
  start: "top",
  middle: "middle",
  end: "bottom",
};

const pick = <T>(table: Readonly<Record<string, T>>, v: unknown): T | undefined => {
  const key = str(v);
  return key !== undefined && Object.hasOwn(table, key) ? table[key] : undefined;
};

/** A shape's looks as kb's, over `base` (what its kind draws by when tldraw says nothing). */
function looksOf(shape: TlRecord, base: CanvasLooksPatch = {}): CanvasLooksPatch {
  const props = shape.props ?? {};
  const opacity =
    typeof shape.opacity === "number" && shape.opacity < 1 ? shape.opacity : undefined;
  const patch: CanvasLooksPatch = {
    ...base,
    ...(pick(FILLS, props.fill) === undefined ? {} : { fill: pick(FILLS, props.fill) }),
    ...(pick(DASHES, props.dash) === undefined ? {} : { dash: pick(DASHES, props.dash) }),
    ...(pick(SIZES, props.size) === undefined ? {} : { size: pick(SIZES, props.size) }),
    ...(pick(FONTS, props.font) === undefined ? {} : { font: pick(FONTS, props.font) }),
    ...(pick(ALIGNS, props.align ?? props.textAlign) === undefined
      ? {}
      : { align: pick(ALIGNS, props.align ?? props.textAlign) }),
    ...(pick(VALIGNS, props.verticalAlign) === undefined
      ? {}
      : { valign: pick(VALIGNS, props.verticalAlign) }),
    ...(opacity === undefined ? {} : { opacity }),
  };
  return patch;
}

/** `item` in `shape`'s colour and looks. */
function dressed<N extends CanvasNode>(item: N, shape: TlRecord, base?: CanvasLooksPatch): N {
  const color = pick(COLORS, shape.props?.color);
  const coloured = color === undefined || color === null ? item : { ...item, color };
  return withStyle(coloured, looksOf(shape, base));
}

/** tldraw's geo forms as kb's shapes; the rest drawn as their nearest, and reported. */
const GEOS: Readonly<Record<string, CanvasShapeKind>> = {
  rectangle: "rect",
  ellipse: "ellipse",
  oval: "ellipse",
  diamond: "diamond",
  rhombus: "diamond",
  "rhombus-2": "diamond",
  triangle: "triangle",
  hexagon: "hexagon",
  star: "star",
  cloud: "cloud",
  "arrow-left": "arrow-left",
  "arrow-right": "arrow-right",
  "arrow-up": "arrow-up",
  "arrow-down": "arrow-down",
  "check-box": "check-box",
};

/** tldraw's arrowheads as kb's heads; null is none. */
const HEADS: Readonly<Record<string, CanvasHead | null>> = {
  none: null,
  arrow: "arrow",
  triangle: "arrow",
  inverted: "open",
  dot: "dot",
  diamond: "diamond",
  square: "bar",
  pipe: "bar",
  bar: "bar",
};

// ── values ──────────────────────────────────────────────────────────────

/** A meta value as field values: words, numbers and truths as they are, a list each, anything else as JSON. */
function valuesOf(value: unknown): TldrawValue[] {
  if (value === null || value === undefined || value === "") return [];
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return [value];
  }
  if (Array.isArray(value)) return value.flatMap((v) => valuesOf(v));
  return [JSON.stringify(value)];
}

// ── the lowering ────────────────────────────────────────────────────────

const num = (v: unknown, fallback = 0) =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback;

/** A text shape's box: tldraw measures it as it lays the words out; kb estimates it from them. */
const TEXT_SIZES: Readonly<Record<string, number>> = { s: 18, m: 24, l: 36, xl: 44 };
function textBox(shape: TlRecord, words: string): { width: number; height: number } {
  const props = shape.props ?? {};
  const font = TEXT_SIZES[str(props.size) ?? "m"] ?? 24;
  const rows = words.split("\n");
  const longest = Math.max(1, ...rows.map((row) => row.length));
  const measured = Math.ceil(longest * font * 0.55) + 16;
  const width =
    props.autoSize === false ? num(props.w, measured) : Math.max(num(props.w), measured);
  return { width, height: Math.ceil(rows.length * font * 1.35) + 8 };
}

interface Lowering {
  readonly byId: ReadonlyMap<string, TlRecord>;
  /** Each parent's shapes, by its id: a page's or a shape's. */
  readonly children: ReadonlyMap<string, readonly TlRecord[]>;
  readonly ids: TldrawIds;
  readonly reported: string[];
  readonly records: TldrawRecordNode[];
  /** How many shapes of each kind kb does not draw, said once each at the end. */
  readonly skipped: Map<string, number>;
}

/** Where a shape leads: its drill (a page, and an item on it), its url, or its one link mark. */
function leadOf(
  shape: TlRecord,
  words: TipTapNode | string,
  low: Lowering,
): CanvasItemLink | undefined {
  const drill = shape.meta?.drill;
  if (isRecord(drill) && typeof drill.to === "string") {
    const focus = typeof drill.focus === "string" ? itemIdOf(drill.focus) : undefined;
    return { node: low.ids.page(drill.to), ...(focus === undefined ? {} : { item: focus }) };
  }
  const url = str(shape.props?.url);
  if (url !== undefined && isLinkUrl(url)) return { url };
  const marks = linkMarks(words);
  return marks.length === 1 && marks[0] !== undefined ? { url: marks[0] } : undefined;
}

/** `shape`'s record node, kept for the write, when it carries one; the node id it stands for. */
function recordOf(shape: TlRecord, page: string, low: Lowering): NodeId | undefined {
  if (!carriesRecord(shape)) return undefined;
  const fields = Object.entries(shape.meta ?? {}).flatMap(([name, value]) => {
    const values = NAVIGATION_KEYS.has(name) ? [] : valuesOf(value);
    return values.length === 0 ? [] : [{ name, values }];
  });
  const words =
    shape.type === "frame"
      ? (str(shape.props?.name) ?? "")
      : tldrawText(wordsOf(shape.props ?? {}), "markdown");
  low.records.push({ key: shape.id, page, text: words, fields });
  return low.ids.record(shape.id);
}

/** Where a shape is lowered to: its place on the canvas, the frame it is in, and its page. */
interface Placing {
  readonly at: { readonly x: number; readonly y: number };
  readonly frame: string | undefined;
  readonly page: string;
}

/** What every item a shape becomes carries: its id, box, frame and lock. */
interface ItemBase {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly parent?: string;
  readonly locked?: true;
}

/** What a shape's kind draws from: the shape, its item base, its words and the record node it stands for. */
interface Drawing {
  readonly shape: TlRecord;
  readonly base: ItemBase;
  readonly words: TipTapNode | string;
  readonly nodeId: NodeId | undefined;
}

/** A `geo` as a shape, or as a card when it carries a record. */
function geoItem({ shape, base, words, nodeId }: Drawing, low: Lowering): CanvasNode {
  const geo = str(shape.props?.geo) ?? "rectangle";
  if (nodeId !== undefined) {
    if (geo !== "rectangle") low.reported.push(`${shape.id}: a ${geo} record is drawn as a card`);
    return dressed({ ...base, type: "kb-node", nodeId }, shape);
  }
  const form = GEOS[geo];
  if (form === undefined) low.reported.push(`${shape.id}: a ${geo} is drawn as a rect`);
  const label = tldrawText(words, "plain");
  return dressed(
    { ...base, type: "shape", shape: form ?? "rect", ...(label === "" ? {} : { label }) },
    shape,
  );
}

/** A `text` with no outline or ground, sized from its words; a `note` a text card in its colour (yellow when it has none). */
function textItem({ shape, base, words, nodeId }: Drawing): CanvasNode {
  const plain = tldrawText(words, "plain");
  const isText = shape.type === "text";
  const box = isText ? textBox(shape, plain) : { width: base.width, height: base.height };
  const flat: CanvasLooksPatch = isText ? { fill: "none", dash: "none" } : { fill: "solid" };
  const sized = { ...base, ...box };
  if (nodeId !== undefined) return dressed({ ...sized, type: "kb-node", nodeId }, shape, flat);
  const item = dressed({ ...sized, type: "text", text: plain }, shape, flat);
  const uncoloured = !isText && pick(COLORS, shape.props?.color) === undefined;
  return uncoloured ? { ...item, color: "yellow" } : item;
}

/** The item `shape` is where `placing` puts it, or undefined for one kb does not draw. */
function itemOf(shape: TlRecord, placing: Placing, low: Lowering): CanvasNode | undefined {
  const props = shape.props ?? {};
  const base: ItemBase = {
    id: itemIdOf(shape.id),
    x: placing.at.x,
    y: placing.at.y,
    width: Math.max(1, num(props.w, 100)),
    height: Math.max(1, num(props.h, 100) + num(props.growY)),
    ...(placing.frame === undefined ? {} : { parent: placing.frame }),
    ...(shape.isLocked ? { locked: true as const } : {}),
  };
  const kind = shape.type ?? "";
  if (!["frame", "geo", "text", "note"].includes(kind)) {
    low.skipped.set(kind, (low.skipped.get(kind) ?? 0) + 1);
    return undefined;
  }
  const words = wordsOf(props);
  const drawing: Drawing = { shape, base, words, nodeId: recordOf(shape, placing.page, low) };
  if (num(shape.rotation) !== 0) low.reported.push(`${shape.id}: its turn is not kept`);
  const item: CanvasNode =
    kind === "frame"
      ? {
          ...base,
          type: "group",
          label: str(props.name) ?? "",
          ...(drawing.nodeId === undefined ? {} : { nodeId: drawing.nodeId }),
        }
      : kind === "geo"
        ? geoItem(drawing, low)
        : textItem(drawing);
  const lead = leadOf(shape, words, low);
  return lead === undefined ? item : { ...item, link: lead };
}

/** The shapes under `parentId`, in paint order: each, then what it holds. */
function lowerChildren(parentId: string, placing: Placing, low: Lowering, out: CanvasNode[]): void {
  const children = (low.children.get(parentId) ?? []).toSorted(byIndex);
  for (const shape of children) {
    const at = { x: placing.at.x + num(shape.x), y: placing.at.y + num(shape.y) };
    if (shape.type === "arrow") continue;
    if (shape.type === "group") {
      lowerChildren(shape.id, { ...placing, at }, low, out);
      continue;
    }
    const item = itemOf(shape, { ...placing, at }, low);
    if (item === undefined) continue;
    out.push(item);
    const frame = shape.type === "frame" ? item.id : placing.frame;
    lowerChildren(shape.id, { ...placing, at, frame }, low, out);
  }
}

/** Where on the canvas a shape's origin is: its own offset over every parent's. */
function originOf(shape: TlRecord, byId: ReadonlyMap<string, TlRecord>): { x: number; y: number } {
  let at = { x: num(shape.x), y: num(shape.y) };
  for (
    let up = byId.get(shape.parentId ?? "");
    up !== undefined;
    up = byId.get(up.parentId ?? "")
  ) {
    at = { x: at.x + num(up.x), y: at.y + num(up.y) };
  }
  return at;
}

/** The page a shape is on: the page its chain of parents ends at. */
function pageOf(shape: TlRecord, byId: ReadonlyMap<string, TlRecord>): string {
  let up = shape.parentId ?? "";
  for (let parent = byId.get(up); parent !== undefined; parent = byId.get(up))
    up = parent.parentId ?? "";
  return up;
}

/** `arrows`, one page's, as edges where both ends are bound to items (by `bindings`, each arrow's), lines where not. */
function lowerArrows(
  arrows: readonly TlRecord[],
  bindings: ReadonlyMap<string, readonly TlRecord[]>,
  items: ReadonlyMap<string, CanvasNode>,
  low: Lowering,
): { edges: CanvasEdge[]; lines: CanvasNode[] } {
  const edges: CanvasEdge[] = [];
  const lines: CanvasNode[] = [];
  for (const arrow of arrows.toSorted(byIndex)) {
    const props = arrow.props ?? {};
    const ends = (terminal: string) =>
      bindings.get(arrow.id)?.find((b) => b.props?.terminal === terminal);
    const [start, end] = [ends("start"), ends("end")];
    const from = items.get(itemIdOf(start?.toId ?? ""));
    const to = items.get(itemIdOf(end?.toId ?? ""));
    const head = (key: string): CanvasHead | null => pick(HEADS, props[key]) ?? null;
    const label = tldrawText(wordsOf(props), "plain");
    if (from !== undefined && to !== undefined && start !== undefined && end !== undefined) {
      const anchor = (b: TlRecord) => {
        const a = b.props?.normalizedAnchor;
        return isRecord(a) ? { x: num(a.x, 0.5), y: num(a.y, 0.5) } : { x: 0.5, y: 0.5 };
      };
      const bend = num(props.bend);
      let edge: CanvasEdge = {
        id: itemIdOf(arrow.id),
        fromNode: from.id,
        toNode: to.id,
        ...(label === "" ? {} : { label }),
        ...(props.kind === "elbow"
          ? { route: "elbow" as const }
          : bend === 0
            ? { route: "straight" as const }
            : { route: "arc" as const, bend: -bend }),
      };
      edge = withEnd(withEnd(edge, "from", { anchor: anchor(start) }), "to", {
        anchor: anchor(end),
      });
      edge = withHead(withHead(edge, "from", head("arrowheadStart")), "to", head("arrowheadEnd"));
      const color = pick(COLORS, props.color);
      edges.push(
        withStyle(color === undefined || color === null ? edge : { ...edge, color }, {
          dash: pick(DASHES, props.dash),
        }),
      );
      continue;
    }
    const origin = originOf(arrow, low.byId);
    const point = (v: unknown) => (isRecord(v) ? { x: num(v.x), y: num(v.y) } : { x: 0, y: 0 });
    const [a, b] = [point(props.start), point(props.end)];
    const [minX, minY] = [Math.min(a.x, b.x), Math.min(a.y, b.y)];
    const [w, h] = [Math.max(1, Math.abs(b.x - a.x)), Math.max(1, Math.abs(b.y - a.y))];
    const rel = (p: { x: number; y: number }) => ({ x: (p.x - minX) / w, y: (p.y - minY) / h });
    const line: CanvasNode = withHead(
      withHead(
        {
          id: itemIdOf(arrow.id),
          type: "path",
          x: origin.x + minX,
          y: origin.y + minY,
          width: w,
          height: h,
          points: [rel(a), rel(b)],
        },
        "from",
        head("arrowheadStart"),
      ),
      "to",
      head("arrowheadEnd"),
    );
    lines.push(line);
    low.reported.push(`${arrow.id}: an arrow not bound at both ends is drawn as a line`);
  }
  return { edges, lines };
}

/**
 * The board `raw` (tldraw's store records) is, lowered to kb's canvas with
 * the node ids `ids` gives each page and each record. Pure; the records
 * may come from any tldraw file.
 */
export function tldrawBoard(raw: readonly unknown[], ids: TldrawIds): TldrawBoard {
  const records = raw.flatMap((r) => asRecord(r) ?? []);
  const shapes = records.filter((r) => r.typeName === "shape");
  const bindings = records.filter((r) => r.typeName === "binding" && r.type === "arrow");
  const bindingsOf = Map.groupBy(bindings, (b) => b.fromId ?? "");
  const low: Lowering = {
    byId: new Map(shapes.map((s) => [s.id, s])),
    children: Map.groupBy(shapes, (s) => s.parentId ?? ""),
    ids,
    reported: [],
    records: [],
    skipped: new Map(),
  };
  const arrowsOn = Map.groupBy(
    shapes.filter((s) => s.type === "arrow"),
    (s) => pageOf(s, low.byId),
  );
  const pages = records
    .filter((r) => r.typeName === "page")
    .toSorted(byIndex)
    .map((page) => {
      const nodes: CanvasNode[] = [];
      lowerChildren(page.id, { at: { x: 0, y: 0 }, frame: undefined, page: page.id }, low, nodes);
      const items = new Map(nodes.map((item) => [item.id, item]));
      const { edges, lines } = lowerArrows(arrowsOn.get(page.id) ?? [], bindingsOf, items, low);
      return { key: page.id, name: page.name ?? "", doc: { nodes: [...nodes, ...lines], edges } };
    });
  for (const [kind, count] of low.skipped) {
    low.reported.push(`${String(count)} ${kind} shape${count === 1 ? "" : "s"}: not drawn`);
  }
  const others = records.filter(
    (r) =>
      ![
        "page",
        "shape",
        "binding",
        "document",
        "camera",
        "instance",
        "pointer",
        "instance_page_state",
        "instance_presence",
        "user",
      ].includes(r.typeName),
  );
  const kinds = new Set(others.map((r) => r.typeName));
  for (const kind of kinds) low.reported.push(`${kind} records: not imported`);
  return { pages, records: low.records, reported: low.reported };
}
