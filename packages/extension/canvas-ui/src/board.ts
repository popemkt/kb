/**
 * The canvas family's board, as the page's `BoardService`: a node's board
 * is its child `#canvas`, made when it has none, and a node is on it when a
 * card shows it. Asked to pin nodes, it places a card for each node not on
 * the board yet, its picture above it, in rows below what is there, through
 * the family's own `place` verb, so one pin is one write and one undo step.
 * A half that wants a board injects the service and names nothing of this
 * family.
 */
import { isCanvasNode, isKbNode, type CanvasDoc } from "@kb/canvas";
import type { Board, BoardCard, BoardReply, BrowserHost } from "@kb/ui-sdk";
import { createCanvasNode, readCanvasDoc } from "./canvas-api";
import { canvasPath } from "./routes";

/** A pinned card's column width, its picture's side, and a row's height. */
const COLUMN = 300;
const PICTURE = 280;
const CARD_HEIGHT = 72;
const GAP = 40;
const ROW = PICTURE + CARD_HEIGHT + GAP;
const PER_ROW = 4;

/** The placements (`place`'s items) that put `cards` in rows below everything on `doc`. */
export function placementsFor(doc: CanvasDoc, cards: readonly BoardCard[]): readonly unknown[] {
  const top = doc.nodes.reduce((bottom, item) => Math.max(bottom, item.y + item.height + GAP), 0);
  return cards.flatMap((card, i) => {
    const x = (i % PER_ROW) * COLUMN;
    const y = top + Math.floor(i / PER_ROW) * ROW;
    const shown = {
      make: { preset: "kb-node", nodeId: card.node, width: PICTURE, height: CARD_HEIGHT },
      at: { x, y: card.picture === undefined ? y : y + PICTURE + 8 },
    };
    if (card.picture === undefined) return [shown];
    const picture = {
      make: { preset: "image", file: card.picture, width: PICTURE, height: PICTURE },
      at: { x, y },
    };
    return [picture, shown];
  });
}

/** The board over the page's replica and invoke path. */
export function canvasBoard(host: Pick<BrowserHost, "invoke" | "node">): Board {
  const pin = async (
    owner: string,
    title: string,
    cards: readonly BoardCard[],
  ): Promise<BoardReply> => {
    // The page's replica holds a node the page just wrote (its commit is local first).
    const existing = (host.node(owner)?.children ?? [])
      .map((id) => host.node(id))
      .find((child) => child !== undefined && isCanvasNode(child));
    const board = existing?.id ?? (await createCanvasNode(title, owner, host));
    if (board === null) return { ok: false, reason: "the board could not be made" };
    const doc = readCanvasDoc(existing);
    const shown = new Set(doc.nodes.filter(isKbNode).map((item) => item.nodeId));
    const missing = cards.filter((card) => !shown.has(card.node));
    if (missing.length > 0) {
      const placed = await host.invoke("ext.canvas.place", {
        canvasId: board,
        items: placementsFor(doc, missing),
      });
      if (placed.status === "failed") return { ok: false, reason: placed.message };
    }
    return { ok: true, board, path: canvasPath({ id: board }), placed: missing.length };
  };
  return { pin };
}
