/** Field discovery for the canvas script protocol; the performer only consumes field identities. */
import { Effect } from "effect";
import { z } from "zod";
import { CoreInvoke, KbCtx } from "@kb/contracts";
import { IndexedNodes, ResolveError, resolveFieldIn } from "@kb/model";
import { CanvasTxError, canvasStep } from "./write.ts";

export const RUN_FIELD_NAMES = { input: "input", output: "output" } as const;

/** The id of the field named `name`: the field of that name, made when kb has none. */
export const runFieldEffect = Effect.fn("ext.canvas.run.field")(function* (name: string) {
  const ctx = yield* KbCtx;
  const found = yield* canvasStep(() => {
    try {
      return resolveFieldIn(IndexedNodes.of(ctx.nodes), name);
    } catch (err) {
      if (err instanceof ResolveError && err.code === "not_found") return null;
      throw err;
    }
  });
  if (found !== null) return found;
  const invoke = yield* CoreInvoke;
  if (invoke === null)
    return yield* Effect.fail(new CanvasTxError("this host runs no invoke core"));
  const made = yield* invoke({ id: "field.define", input: { name } }, "write");
  if (made.status === "failed") return yield* Effect.fail(new CanvasTxError(made.message));
  return z.object({ id: z.string() }).parse(made.output).id;
});
