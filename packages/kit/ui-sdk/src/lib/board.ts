/**
 * A board of nodes, as a service: a spatial board kept under a node, with a
 * card placed on it for each node asked for, the node's picture beside it
 * when it has one. The family that draws boards provides it while its page
 * half is loaded (the canvas family, over its own actions); a half that
 * wants a board (the gallery's moodboard) injects the service, so it waits,
 * pending, while no family provides it, and names no other family's
 * actions or code.
 */
import { Service } from "@kb/plugin";

/** A node to put on a board, and the asset (`assets/…`) that pictures it, if any. */
export interface BoardCard {
  readonly node: string;
  readonly picture?: string;
}

/** Where the board is, or why there is none, in words the person can read. */
export type BoardReply =
  | {
      readonly ok: true;
      /** The board's node. */
      readonly board: string;
      /** The path that opens it. */
      readonly path: string;
      /** How many cards were placed now; those already on it are left where they are. */
      readonly placed: number;
    }
  | { readonly ok: false; readonly reason: string };

export interface Board {
  /**
   * The board under `owner` (made, titled `title`, when it has none), with a
   * card for each of `cards` not on it yet.
   */
  readonly pin: (owner: string, title: string, cards: readonly BoardCard[]) => Promise<BoardReply>;
}

/** Where a family that draws boards provides them while it is loaded. */
export const BoardService = Service<Board>()("ui.board");
