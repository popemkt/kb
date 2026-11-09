import {
  DEFAULT_BUDGET_MS,
  TxAfterPoint,
  type Listener,
  type ReactionFailure,
  type Reactions,
  type TxReaction,
} from "@kb/contracts";
import type { Kernel } from "@kb/plugin";

/** The committing registry owns listener health; callbacks never change plugin admission. */
export function reactionsFrom(
  kernel: Pick<Kernel, "contributions">,
  budgetMs: number = DEFAULT_BUDGET_MS.intercept,
): Reactions {
  const failed = new Map<
    string,
    { readonly listener: Listener<TxReaction>; readonly failure: ReactionFailure }
  >();
  const listeners = () => kernel.contributions(TxAfterPoint);
  return {
    listeners,
    budgetMs,
    report: (listener, failure) => {
      if (failure === null) failed.delete(listener.id);
      else
        failed.set(listener.id, {
          listener,
          failure: {
            owner: listener.owner,
            id: listener.id,
            message: `tx/after ${listener.id}: ${failure}`,
          },
        });
    },
    failures: () => {
      const active = new Set(listeners().map(({ value }) => value));
      return [...failed.values()]
        .filter(({ listener }) => active.has(listener.value))
        .map(({ failure }) => failure);
    },
  };
}
