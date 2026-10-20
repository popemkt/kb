/**
 * How the invoke core runs its interception points (`DESIGN.md` → Action
 * registry → Interception): the guards a call is asked of, the interceptors
 * it passes through, and where they come from.
 *
 * - **Matching is indexed.** Which listeners match an action depends only on
 *   the action (its id, its mode, a batch's parts) and on which listeners
 *   are contributed, so it is worked out once per action and kept until the
 *   listeners change, never by scanning every listener on every call.
 * - **Order is the kernel's.** A point's contributions are in the order
 *   their plugins applied: a plugin applies only once every service it
 *   injects is provided, so its dependencies' listeners come first, then
 *   load order. Nothing else orders them.
 * - **Guards fail closed.** A guard that fails, dies, or overruns its budget
 *   denies, and the refusal names the plugin. A deny is final: no guard
 *   after it is asked (Cordis's `bail`). An ask is the strictest answer
 *   otherwise, decided by the first guard that gave it.
 * - **Interceptors fail loudly.** One that fails or overruns aborts the call
 *   as `internal`, naming the plugin. None is ever skipped.
 */
import { Cause, Effect, Exit, Option } from "effect";
import {
  ActionGuardPoint,
  ActionInterceptorPoint,
  DEFAULT_BUDGET_MS,
  hasPerson,
  type ActionGuard,
  type ActionInterceptor,
  type ActionInvocation,
  type ApprovalCall,
  type CommitCall,
  type GuardCall,
  type GuardVerdict,
  type Interception,
  type Listener,
} from "@kb/contracts";
import { matchSpecificity } from "@kb/model";
import type { Contribution, Kernel } from "@kb/plugin";

type Action = ApprovalCall["action"];

/** Whether `match` names `action`, or, for a batch, any of the actions it is a batch of. */
function matches(match: string, action: Action): boolean {
  if (matchSpecificity(match, action) !== null) return true;
  return (action.batchOf ?? []).some((part) => matchSpecificity(match, part) !== null);
}

/**
 * An index over one ordered listener list: the listeners matching an
 * action, worked out the first time that action is asked about.
 */
function indexOf<L extends { readonly match: string }>(
  listeners: readonly Listener<L>[],
): (action: Action) => readonly Listener<L>[] {
  const byAction = new Map<string, readonly Listener<L>[]>();
  return (action) => {
    const held = byAction.get(action.id);
    if (held !== undefined) return held;
    const matching = listeners.filter(({ value }) => matches(value.match, action));
    byAction.set(action.id, matching);
    return matching;
  };
}

function listenersOf<L>(contributions: readonly Contribution<L>[]): Listener<L>[] {
  return contributions.map(({ owner, id, value }) => ({ owner, id, value }));
}

/** What a host passes beside its listeners. */
export interface InterceptionOptions {
  /**
   * The plugins whose guards the deployment requires: while one is not
   * applied, every call is denied.
   */
  readonly required?: readonly string[];
  readonly budgetMs?: Interception["budgetMs"];
}

/**
 * The interception a kernel's plugins contribute. The indexes are rebuilt
 * when the kernel moves, so a plugin that loads or goes is seen at once,
 * whole (a plugin's contributions appear and go together, `@kb/plugin`).
 */
export function interceptionFrom(kernel: Kernel, options: InterceptionOptions = {}): Interception {
  let indexed: { readonly version: number; readonly at: Interception } | null = null;
  const current = (): Interception => {
    if (indexed?.version === kernel.version()) return indexed.at;
    const at = interceptionOf({
      guards: listenersOf(kernel.contributions(ActionGuardPoint)),
      interceptors: listenersOf(kernel.contributions(ActionInterceptorPoint)),
    });
    indexed = { version: kernel.version(), at };
    return at;
  };
  const required = options.required ?? [];
  return {
    guards: (action) => current().guards(action),
    interceptors: (action) => current().interceptors(action),
    missing: () => {
      const applied = new Set(
        kernel
          .plugins()
          .filter((plugin) => plugin.applied)
          .map((plugin) => plugin.name),
      );
      return required.filter((name) => !applied.has(name));
    },
    budgetMs: options.budgetMs ?? DEFAULT_BUDGET_MS,
  };
}

/** The interception of a fixed list of listeners: a host with no kernel for them, and tests. */
export function interceptionOf(
  listeners: {
    readonly guards?: readonly Listener<ActionGuard>[];
    readonly interceptors?: readonly Listener<ActionInterceptor>[];
  },
  options: InterceptionOptions = {},
): Interception {
  return {
    guards: indexOf(listeners.guards ?? []),
    interceptors: indexOf(listeners.interceptors ?? []),
    missing: () => options.required ?? [],
    budgetMs: options.budgetMs ?? DEFAULT_BUDGET_MS,
  };
}

/** What the guards decided, and, when it is not `allow`, which guard and rule decided it. */
export type GuardOutcome =
  | { readonly decision: "allow" }
  | {
      readonly decision: "ask" | "deny";
      readonly plugin: string;
      readonly rule: string;
      readonly message: string;
      readonly details?: Readonly<Record<string, unknown>>;
    };

/**
 * Run one listener's effect with an abort signal of its own, aborted when
 * the call is interrupted or the budget runs out. `None` when it overran.
 */
function budgeted<A>(
  budgetMs: number,
  run: (signal: AbortSignal) => Effect.Effect<A>,
): Effect.Effect<Exit.Exit<Option.Option<A>>> {
  return Effect.suspend(() => {
    const controller = new AbortController();
    return run(controller.signal).pipe(
      Effect.timeoutOption(budgetMs),
      Effect.tap((answered) =>
        Effect.sync(() => {
          if (Option.isNone(answered)) controller.abort(new Error("budget exceeded"));
        }),
      ),
      Effect.onInterrupt(() => Effect.sync(() => controller.abort(new Error("interrupted")))),
      Effect.exit,
    );
  });
}

function whyFailed(cause: Cause.Cause<unknown>): string {
  const error = Cause.squash(cause);
  return error instanceof Error ? error.message : String(error);
}

/** One guard's verdict, failing closed: a guard that fails or overruns denies. */
const askOne = Effect.fnUntraced(function* (
  guard: Listener<ActionGuard>,
  budgetMs: number,
  ask: (signal: AbortSignal) => Effect.Effect<GuardVerdict>,
) {
  const exit = yield* budgeted(budgetMs, ask).pipe(
    Effect.withSpan("kb.guard", { attributes: { plugin: guard.owner, guard: guard.id } }),
  );
  if (Exit.isFailure(exit)) {
    return {
      decision: "deny",
      rule: "guard-failed",
      message: `guard ${guard.id} of plugin ${guard.owner} failed, so the call is denied: ${whyFailed(exit.cause)}`,
    } satisfies GuardVerdict;
  }
  if (Option.isNone(exit.value)) {
    return {
      decision: "deny",
      rule: "guard-timeout",
      message: `guard ${guard.id} of plugin ${guard.owner} did not answer within ${budgetMs} ms, so the call is denied`,
    } satisfies GuardVerdict;
  }
  return exit.value.value;
});

/**
 * Ask every guard matching `action`, in order, through `ask`. A deny ends
 * it; otherwise the first ask holds; otherwise the call is allowed. While a
 * guard the deployment requires is not there, every call is denied.
 */
const askGuards = Effect.fn("kb.guards")(function* (
  interception: Interception,
  action: Action,
  question: (guard: ActionGuard) => ((signal: AbortSignal) => Effect.Effect<GuardVerdict>) | null,
) {
  const missing = interception.missing();
  if (missing.length > 0) {
    return {
      decision: "deny",
      plugin: missing.join(", "),
      rule: "required-guard-missing",
      message: `the deployment requires the guards of ${missing.join(", ")}, which are not loaded right now, so no call runs`,
    } satisfies GuardOutcome;
  }
  let asked: GuardOutcome | null = null;
  for (const guard of interception.guards(action)) {
    const ask = question(guard.value);
    if (ask === null) continue;
    const verdict = yield* askOne(guard, interception.budgetMs.guard, ask);
    if (verdict.decision === "allow") continue;
    const outcome: GuardOutcome = { ...verdict, plugin: guard.owner };
    if (verdict.decision === "deny") return outcome;
    asked ??= outcome;
  }
  return asked ?? ({ decision: "allow" } satisfies GuardOutcome);
});

/** Read-only, so a guard cannot change what it is asked about. */
function frozen<T extends object>(value: T): T {
  return Object.freeze({ ...value });
}

/** What the guards decide about a call about to run, or about listing it (`phase`). */
export function guardBefore(
  interception: Interception,
  call: Omit<GuardCall, "signal">,
): Effect.Effect<GuardOutcome> {
  return askGuards(interception, call.action, ({ before }) =>
    before === undefined ? null : (signal) => before(frozen({ ...call, signal })),
  );
}

/** What the guards decide about a call's commit, with what it writes. */
export function guardCommit(
  interception: Interception,
  call: Omit<CommitCall, "signal">,
): Effect.Effect<GuardOutcome> {
  return askGuards(interception, call.action, ({ commit }) =>
    commit === undefined ? null : (signal) => commit(frozen({ ...call, signal })),
  );
}

/**
 * What an outcome refuses a call with: a deny always, an ask unless a
 * person stands behind the call. The refusal names the plugin and rule that
 * decided it beside what the guard said.
 */
export function refusalOf(
  outcome: GuardOutcome,
  invocation: ActionInvocation,
): {
  readonly code: "forbidden" | "approval_required";
  readonly message: string;
  readonly details: Readonly<Record<string, unknown>>;
} | null {
  if (outcome.decision === "allow") return null;
  if (outcome.decision === "ask" && hasPerson(invocation)) return null;
  return {
    code: outcome.decision === "deny" ? "forbidden" : "approval_required",
    message: outcome.message,
    details: { ...outcome.details, decidedBy: { plugin: outcome.plugin, rule: outcome.rule } },
  };
}
