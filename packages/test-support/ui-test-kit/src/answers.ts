/**
 * The page's query answers over an index in this thread, for a test: each
 * query answered on the turn after it is asked, as the page's engine answers
 * it in its worker, without one.
 */
import { answerOf, type KbIndex, ReplicaQueries } from "@kb/ui-sdk";

export function answersOver(index: KbIndex, budgetMs?: number): ReplicaQueries {
  return new ReplicaQueries(
    {
      run: (request) =>
        Promise.resolve().then(() => answerOf(index, request, () => performance.now())),
    },
    () => index.generation,
    {
      now: () => Date.now(),
      set: (run, ms) => {
        const handle = setTimeout(run, ms);
        return () => clearTimeout(handle);
      },
    },
    budgetMs,
  );
}
