import { Context, Effect, Exit, Option } from "effect";
import {
  CurrentCall,
  failed,
  type ActionInvocation,
  type ActionReceipt,
  type Listener,
  type ReactionHost,
  type Reactions,
  type StoreCommit,
  type TxChange,
  type TxMatch,
  type TxReaction,
} from "@kb/contracts";
import { changedFields, type NodeWrite, typeRefsOf } from "@kb/model";
import { sealedPart } from "./interception.ts";
import { budgeted, whyFailed } from "./listener-budget.ts";

export const MAX_REACTION_DEPTH = 4;

interface ReactionOrigin {
  readonly id: string;
  readonly depth: number;
}
interface QueuedCommit {
  readonly change: TxChange;
  readonly origin: ReactionOrigin | null;
}
interface CommitFrame {
  readonly open: () => boolean;
  readonly capture: (commit: StoreCommit) => Effect.Effect<void>;
}

export const CurrentCommitFrame = Context.Reference<CommitFrame | null>("kb/CurrentCommitFrame", {
  defaultValue: () => null,
});
const CurrentReaction = Context.Reference<ReactionOrigin | null>("kb/CurrentReaction", {
  defaultValue: () => null,
});

function matchesWrite(match: TxMatch, { before, after }: NodeWrite): boolean {
  if (Object.keys(match).length === 0) return true;
  if (match.created === true && before === undefined && after !== undefined) return true;
  if (match.deleted === true && before !== undefined && after === undefined) return true;
  const was = new Set(typeRefsOf(before));
  const now = new Set(typeRefsOf(after));
  return (
    (match.tagged ?? []).some((tag) => now.has(tag) && !was.has(tag)) ||
    (match.untagged ?? []).some((tag) => was.has(tag) && !now.has(tag)) ||
    changedFields(before, after).some((field) => match.fields?.includes(field) === true)
  );
}

/** One invocation's local receipts; its drain keeps callback-made commits on this same queue. */
export function commitFrame<R>(
  reactions: Reactions,
  invoke: (invocation: ActionInvocation) => Effect.Effect<ActionReceipt, never, R>,
  services: Context.Context<R>,
): { readonly frame: CommitFrame; readonly drain: Effect.Effect<void> } {
  const pending: QueuedCommit[] = [];
  let active = true;
  const frame: CommitFrame = {
    open: () => active,
    capture: Effect.fn("kb.reaction.capture")(
      function* (commit: StoreCommit) {
        if (!active || commit.record === null) return;
        const origin = yield* CurrentReaction;
        const { ops: _ops, ...metadata } = commit.record;
        const change = yield* sealedPart({ tx: metadata, writes: commit.writes });
        pending.push({ change, origin });
      },
      Effect.catchCause((cause) =>
        Effect.logWarning(`tx/after could not capture a commit: ${whyFailed(cause)}`),
      ),
    ),
  };

  const runOne = Effect.fn("kb.reaction")(function* (
    listener: Listener<TxReaction>,
    queued: QueuedCommit,
  ) {
    if (queued.origin?.id === listener.id) return;
    const depth = (queued.origin?.depth ?? 0) + 1;
    const attempted = yield* budgeted(reactions.budgetMs, (signal) => {
      const writes = queued.change.writes.filter((write) =>
        matchesWrite(listener.value.match, write),
      );
      if (writes.length === 0) return Effect.succeed("skipped" as const);
      if (depth > MAX_REACTION_DEPTH) return Effect.succeed("limit" as const);
      let running = true;
      const host: ReactionHost = Object.freeze({
        signal,
        invoke: (id: string, input: Readonly<Record<string, unknown>>) =>
          Effect.suspend(() => {
            if (!running || signal.aborted || !frame.open())
              return Effect.succeed(
                failed(id, "forbidden", `reaction ${listener.id} is no longer running`),
              );
            return invoke({
              id,
              input,
              actor: { kind: "reaction", id: listener.id },
              approved: false,
            }).pipe(
              Effect.provideService(CurrentCall, null),
              Effect.provideService(CurrentReaction, { id: listener.id, depth }),
              Effect.provideService(CurrentCommitFrame, frame),
              Effect.provideContext(services),
            );
          }),
      });
      return Effect.scoped(
        Effect.suspend(() =>
          listener.value.react(
            Object.freeze({ tx: queued.change.tx, writes: Object.freeze(writes) }),
            host,
          ),
        ),
      ).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            running = false;
          }),
        ),
        Effect.as("ran" as const),
      );
    });
    let failure: string | null = null;
    if (Exit.isFailure(attempted)) failure = whyFailed(attempted.cause);
    else if (Option.isNone(attempted.value)) failure = `budget exceeded (${reactions.budgetMs}ms)`;
    else if (attempted.value.value === "skipped") return;
    else if (attempted.value.value === "limit")
      failure = `reaction chain exceeds ${MAX_REACTION_DEPTH}`;
    reactions.report(listener, failure);
    if (failure !== null) yield* Effect.logWarning(`tx/after ${listener.id}: ${failure}`);
  });

  const drain = Effect.gen(function* () {
    while (pending.length > 0) {
      const batch = pending.splice(0);
      const listeners = reactions.listeners();
      yield* Effect.forEach(
        batch,
        (queued) =>
          Effect.forEach(listeners, (listener) => runOne(listener, queued), {
            concurrency: "unbounded",
            discard: true,
          }),
        { discard: true },
      );
    }
  }).pipe(
    Effect.provideService(CurrentCall, null),
    Effect.catchCause((cause) => Effect.logWarning(`tx/after drain failed: ${whyFailed(cause)}`)),
    Effect.ensuring(
      Effect.sync(() => {
        active = false;
      }),
    ),
  );
  return { frame, drain };
}
