/**
 * A look's moodboard: the canvas family's board, through a declared need.
 * The gallery draws no board of its own. Its `moodboard` child injects the
 * page's `BoardService`, so it waits, pending, while no family provides
 * one (the canvas off), and offers the board at its point once one does.
 * The look panel offers "Moodboard" while the point holds it and says what
 * it needs while it does not.
 */
import { Effect } from "effect";
import { definePlugin, Point } from "@kb/plugin";
import { BoardService, type Board } from "@kb/ui-sdk";

/** Where the gallery's `moodboard` child offers the page's board. */
export const MoodboardPoint = Point<Board>()("gallery.moodboard");

/** What the look panel says the moodboard needs while none is offered. */
export const MOODBOARD_NEEDS =
  "The moodboard is a canvas: switch the canvas on in Settings → Extensions";

export const galleryMoodboardPlugin = definePlugin({
  name: "moodboard",
  inject: [BoardService],
  apply: (ctx) =>
    Effect.gen(function* () {
      const board = yield* ctx.get(BoardService);
      yield* ctx.contribute(MoodboardPoint, { id: "board", value: board });
    }),
});
