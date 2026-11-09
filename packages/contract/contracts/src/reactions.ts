import { CORE_POINT_DEFINITIONS } from "./point-definitions.ts";
import { Context, type Effect } from "effect";
import { Point, type PluginContext, type PluginError } from "@kb/plugin";
import type { KbTx, NodeWrite } from "@kb/model";
import type { PluginFailure } from "./extension-report.ts";
import type { ActionReceipt } from "./actions.ts";
import { DEFAULT_BUDGET_MS, type Listener } from "./interception.ts";

import type { TxMatch, TxReaction } from "./tx-match.ts";

/** Frozen commit data, with only the node writes matched by this listener. */
export interface TxChange {
  readonly tx: Readonly<Omit<KbTx, "ops">>;
  readonly writes: readonly NodeWrite[];
}

/** Checked calls while this callback runs; never the session, store, log or a person's approval. */
export interface ReactionHost {
  readonly signal: AbortSignal;
  readonly invoke: (
    id: string,
    input: Readonly<Record<string, unknown>>,
  ) => Effect.Effect<ActionReceipt>;
}

export const TxAfterPoint = Point<TxReaction>()(
  CORE_POINT_DEFINITIONS.txAfter.name,
  CORE_POINT_DEFINITIONS.txAfter.spec,
);

/** Observe matching local commits after the outer call settles. */
export function onCommit(
  plugin: PluginContext,
  match: TxMatch,
  react: TxReaction["react"],
  id = "commit",
): Effect.Effect<void, PluginError> {
  return plugin.contribute(TxAfterPoint, { id, value: { match, react } });
}

export interface ReactionFailure extends PluginFailure {
  readonly id: string;
}

/** The live listeners and their last attempt, held by the committing registry. */
export interface Reactions {
  readonly listeners: () => readonly Listener<TxReaction>[];
  readonly budgetMs: number;
  readonly report: (listener: Listener<TxReaction>, failure: string | null) => void;
  readonly failures: () => readonly ReactionFailure[];
}

const NO_REACTIONS: Reactions = {
  listeners: () => [],
  budgetMs: DEFAULT_BUDGET_MS.intercept,
  report: () => {},
  failures: () => [],
};

export const CurrentReactions = Context.Reference<Reactions>("kb/CurrentReactions", {
  defaultValue: () => NO_REACTIONS,
});
