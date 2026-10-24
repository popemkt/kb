/**
 * What a test asks datalog of in its own thread. The page never holds a
 * DataScript handle: it asks its engine through its query answers, and the
 * engine runs in a worker (`@kb/ui-sdk` → query seam), so the page SDK does
 * not carry one and the page's bundle carries no DataScript. A test builds
 * the index the engine holds here instead (`DatascriptIndex`), or the engine
 * itself behind an in-thread port (`inThreadPort`).
 */
import { answerOf, type KbIndex, ReplicaQueries } from "@kb/ui-sdk";

export { DatascriptIndex, inThreadPort } from "@kb/query";

/**
 * The page's query answers over an index in this thread, for a test: each
 * query answered on the turn after it is asked, as the page's engine answers
 * it in its worker, without one.
 */
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
