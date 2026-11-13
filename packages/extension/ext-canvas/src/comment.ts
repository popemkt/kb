/**
 * The verb an agent and a script comment on a canvas with (DESIGN.md →
 * Canvas documents → Comments): a thread on an item or at a point, or a
 * reply to a comment of one, written as `commentWrite` says and as
 * `node.add` writes a node.
 */
import { Effect } from "effect";
import { z } from "zod";
import { GraphWrites, type ExtensionAction, type KbCtx } from "@kb/contracts";
import { freshId } from "@kb/model";
import { CANVAS_IDS, canvasWorld, commentWrite, type CommentPlace } from "@kb/canvas";
import { CanvasIdSchema } from "./schemas.ts";
import {
  canvasStep,
  planAddEffect,
  readCanvasEffect,
  readableEffect,
  type CanvasFail,
} from "./write.ts";

const commentInput = z
  .object({
    canvasId: CanvasIdSchema,
    text: z.string().min(1).describe("what the comment says"),
    on: z
      .string()
      .min(1)
      .optional()
      .describe(
        "an item to pin a new thread on; a card's thread is on its node, on every card that shows it",
      ),
    at: z
      .object({ x: z.number(), y: z.number() })
      .strict()
      .optional()
      .describe("a point on the canvas to pin a new thread at"),
    replyTo: z
      .string()
      .min(1)
      .optional()
      .describe("a comment of a thread on this canvas to answer; the reply goes under it"),
    id: z.string().min(1).optional().describe("the comment's node id; minted when absent"),
  })
  .refine(
    (input) => [input.on, input.at, input.replyTo].filter((one) => one !== undefined).length === 1,
    { message: "give exactly one of on, at and replyTo" },
  );
const commentOutput = z.object({
  canvasId: z.string(),
  id: z.string(),
  thread: z.string().describe("the thread it is in: its own id when it starts one"),
});

/** Where `input` puts its comment: the one of on, at and replyTo it gives. */
function placeOf(input: z.infer<typeof commentInput>): CommentPlace {
  if (input.replyTo !== undefined) return { replyTo: input.replyTo };
  if (input.at !== undefined) return { at: input.at };
  return { on: input.on ?? "" };
}

const canvasCommentEffect = Effect.fn("ext.canvas.comment")(function* (
  input: z.infer<typeof commentInput>,
): Effect.fn.Return<z.infer<typeof commentOutput>, CanvasFail, KbCtx | GraphWrites> {
  const doc = yield* readCanvasEffect(input.canvasId);
  // The threads as this call may read them: a script answers only those its subject holds.
  const threads = canvasWorld(yield* readableEffect()).threadsOn(input.canvasId);
  const write = yield* canvasStep(() => commentWrite(input.canvasId, placeOf(input), doc, threads));
  // A comment is a node like any other: written as `node.add` writes one.
  // Planned over the graph it lands on, so a reply never drops one written meanwhile.
  const id = input.id ?? (yield* freshId);
  const add = {
    text: input.text,
    tags: [CANVAS_IDS.commentTag],
    parent: write.parent,
    props: Object.entries(write.props).map(([field, value]) => ({ field, value })),
  };
  yield* (yield* GraphWrites).commit((nodes) => planAddEffect(nodes, add, id));
  return { canvasId: input.canvasId, id, thread: write.thread ?? id };
});

export const COMMENT_VERB: ExtensionAction = {
  id: "comment",
  title: "Comment on a canvas",
  description:
    "Start a comment thread pinned on an item (a card's thread is on its node) or at a point, or " +
    "reply to a comment of a thread on the canvas. A comment is a #comment node: its thread under " +
    "the canvas, a reply under the comment it answers. Resolve or reopen a thread by setting its " +
    "comment.state (open or resolved) with node.update.",
  mode: { kind: "write" },
  // A reply goes under the comment it answers, so a script's grant bounds that too.
  targets: ["canvasId", "replyTo"],
  inputSchema: commentInput,
  outputSchema: commentOutput,
  effect: canvasCommentEffect,
};
