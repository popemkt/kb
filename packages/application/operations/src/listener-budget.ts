import { Cause, Effect, type Exit, Option } from "effect";

/**
 * Run one listener's effect with an abort signal of its own, aborted when
 * the call is interrupted or the budget runs out. `None` when it overran.
 */
export const budgeted = Effect.fnUntraced(function* <A>(
  budgetMs: number,
  run: (signal: AbortSignal) => Effect.Effect<A>,
): Effect.fn.Return<Exit.Exit<Option.Option<A>>> {
  return yield* Effect.suspend(() => {
    const controller = new AbortController();
    // The budget aborts the signal before it interrupts the listener, so a
    // listener cleaning up on interruption already sees why.
    const overrun = Effect.sleep(budgetMs).pipe(
      Effect.andThen(Effect.sync(() => controller.abort(new Error("budget exceeded")))),
      Effect.as(Option.none<A>()),
    );
    // Built inside the boundary: a listener that throws while making its
    // effect (or a call it is handed that cannot be sealed) fails here, and
    // fails closed, like one whose effect fails.
    const ran = Effect.suspend(() => run(controller.signal));
    return Effect.raceFirst(ran.pipe(Effect.asSome), overrun).pipe(
      Effect.onInterrupt(() => Effect.sync(() => controller.abort(new Error("interrupted")))),
      Effect.exit,
    );
  });
});

export function whyFailed(cause: Cause.Cause<unknown>): string {
  const error = Cause.squash(cause);
  return error instanceof Error ? error.message : String(error);
}
