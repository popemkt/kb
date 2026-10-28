/**
 * A canvas's pages (DESIGN.md → Canvas documents, Pages): a board is a
 * `#canvas` node whose parent is no canvas, and its pages are itself and
 * the canvases under it in the outline, through canvases only, in outline
 * order — so a page is a node like any other, named by its text, moved and
 * ordered as a node is, and a page's own pages are the board's too. What
 * leads from one page to another is an item's link (`link`).
 */
import type { NodeId } from "@kb/model";
import type { CanvasDoc } from "./doc.ts";
import { itemLead } from "./links.ts";
import type { CanvasWorld } from "./world.ts";

const isCanvas = (world: CanvasWorld, id: NodeId) => world.docOf(id) !== undefined;

/** The board canvas `id` is a page of: itself, or its highest ancestor reached through canvases. */
export function boardOf(world: CanvasWorld, id: NodeId): NodeId {
  let board = id;
  for (
    let up = world.parentOf(board);
    up !== undefined && isCanvas(world, up);
    up = world.parentOf(up)
  ) {
    board = up;
  }
  return board;
}

/** The pages of the board canvas `id` is on, the board first, then each canvas under it in outline order. */
export function canvasPages(world: CanvasWorld, id: NodeId): NodeId[] {
  const pages: NodeId[] = [];
  const visit = (page: NodeId) => {
    pages.push(page);
    for (const child of world.childrenOf(page)) if (isCanvas(world, child)) visit(child);
  };
  visit(boardOf(world, id));
  return pages;
}

/**
 * The name a new page takes among pages named `taken`: "Page N", N the
 * page it will be, or the next number no page is named by — so a page
 * deleted from the middle never makes a new one repeat a name.
 */
export function nextPageName(taken: readonly string[]): string {
  const names = new Set(taken);
  let n = taken.length + 1;
  while (names.has(`Page ${String(n)}`)) n += 1;
  return `Page ${String(n)}`;
}

/** One way from a page to a page of its board: the item followed, and the item shown where it leads. */
export interface PageLink {
  /** The item on the page that leads there (`itemLead`). */
  readonly item: string;
  /** The page it leads to. */
  readonly to: NodeId;
  /** The item on that page shown and selected as it opens, when the link names one. */
  readonly focus?: string;
}

/** The ways `doc`'s items lead to the pages in `pages` (`link`), in document order. */
function pageLinks(doc: CanvasDoc, pages: ReadonlySet<NodeId>): PageLink[] {
  return doc.nodes.flatMap((item) => {
    const lead = itemLead(item);
    if (lead === undefined || !("node" in lead) || !pages.has(lead.node)) return [];
    return [
      { item: item.id, to: lead.node, ...(lead.item === undefined ? {} : { focus: lead.item }) },
    ];
  });
}

const docIn = (world: CanvasWorld, page: NodeId): CanvasDoc =>
  world.docOf(page) ?? { nodes: [], edges: [] };

/**
 * A page of a board as its page graph has it: its name, the ways its items
 * lead to the board's other pages, and the pages whose items lead to it —
 * a drill-down's badges and the back badges a page owes, read, not drawn.
 */
export interface BoardPage {
  readonly id: NodeId;
  /** Its node's text. */
  readonly name: string;
  /** The ways its items lead to other pages of the board, in document order. */
  readonly links: readonly PageLink[];
  /** The other pages whose items lead to it, in page order. */
  readonly from: readonly NodeId[];
}

/** The page graph of the board `id` is a page of: each page, in page order (`canvasPages`). */
export function boardPages(world: CanvasWorld, id: NodeId): BoardPage[] {
  const pages = canvasPages(world, id);
  const all = new Set(pages);
  const links = new Map(
    pages.map((page) => [page, pageLinks(docIn(world, page), all).filter((l) => l.to !== page)]),
  );
  return pages.map((page) => ({
    id: page,
    name: world.textOf(page) ?? "",
    links: links.get(page) ?? [],
    from: pages.filter((other) => links.get(other)?.some((link) => link.to === page) === true),
  }));
}

/** The pages of `id`'s board that no chain of links leads to from the board. */
export function unreachablePages(world: CanvasWorld, id: NodeId): NodeId[] {
  const pages = boardPages(world, id);
  const byId = new Map(pages.map((page) => [page.id, page]));
  const reached = new Set<NodeId>();
  const walk = (page: NodeId) => {
    if (reached.has(page)) return;
    reached.add(page);
    for (const link of byId.get(page)?.links ?? []) walk(link.to);
  };
  walk(pages[0]?.id ?? id);
  return pages.flatMap((page) => (reached.has(page.id) ? [] : [page.id]));
}
