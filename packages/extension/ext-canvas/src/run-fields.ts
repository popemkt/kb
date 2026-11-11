/** Resolve the script protocol once, publishing adoption through the shared conditional write path. */
import { Effect } from "effect";
import { GraphWrites } from "@kb/contracts";
import {
  currentIso,
  freshId,
  present,
  ResolveError,
  domainError,
  domainFromResolve,
} from "@kb/model";
import { planCanvasRunFields, type CanvasRunFields } from "@kb/canvas";

export const runFieldsEffect = Effect.fn("ext.canvas.run.fields")(function* (canvasId: string) {
  const at = yield* currentIso;
  const fresh = { input: yield* freshId, output: yield* freshId };
  let fields: CanvasRunFields | undefined;
  yield* (yield* GraphWrites).commit((nodes) =>
    Effect.try({
      try: () => {
        const plan = planCanvasRunFields(nodes, canvasId, fresh, at);
        fields = plan.fields;
        return plan.tx;
      },
      catch: (error) =>
        error instanceof ResolveError
          ? domainFromResolve(error)
          : domainError("invalid_input", String(error)),
    }),
  );
  return present(fields, "successful canvas field plan");
});
