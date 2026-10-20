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
  type CalledAction,
  type CommitCall,
  type GuardCall,
  type GuardVerdict,
  type InterceptedCall,
  type Interception,
  type Listener,
} from "@kb/contracts";
import { domainError, matchSpecificity, type DomainError, type NodeId } from "@kb/model";
import type { Contribution, Kernel } from "@kb/plugin";

type Action = CalledAction;

/** Whether `match` names `action`, or, for a batch, any of the actions it is a batch of. */
function matches(match: string, action: Action): boolean {
  if (matchSpecificity(match, action) !== null) return true;
  return (action.batchOf ?? []).some((part) => matchSpecificity(match, part) !== null);
}

/**
 * An index over one ordered listener list: the listeners matching an
 * action, worked out the first time that action is asked about. The id keys
 * it because an action's id fixes everything matching reads: its mode and
 * a batch's parts are its definition's (`approvalSubject`), and one index
 * serves one registry's listeners, rebuilt when they change.
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
export function interceptionFrom(
  kernel: Pick<Kernel, "contributions" | "plugins" | "version">,
  options: InterceptionOptions = {},
): Interception {
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
    // The budget aborts the signal before it interrupts the listener, so a
    // listener cleaning up on interruption already sees why.
    const overrun = Effect.sleep(budgetMs).pipe(
      Effect.andThen(Effect.sync(() => controller.abort(new Error("budget exceeded")))),
      Effect.as(Option.none<A>()),
    );
    return Effect.raceFirst(run(controller.signal).pipe(Effect.asSome), overrun).pipe(
      Effect.onInterrupt(() => Effect.sync(() => controller.abort(new Error("interrupted")))),
      Effect.exit,
    );
  });
}

function whyFailed(cause: Cause.Cause<unknown>): string {
  const error = Cause.squash(cause);
  return error instanceof Error ? error.message : String(error);
}

/**
 * One guard's verdict, failing closed: a guard that fails or overruns
 * denies. Its span, `kb.guard`, names the plugin and the guard, and once it
 * answers, the decision and the rule that decided it, so a refusal is on
 * the trace as well as in the receipt's `decidedBy`.
 */
function askOne(
  guard: Listener<ActionGuard>,
  budgetMs: number,
  ask: (signal: AbortSignal) => Effect.Effect<GuardVerdict>,
): Effect.Effect<GuardVerdict> {
  return verdictOf(guard, budgetMs, ask).pipe(
    Effect.tap((verdict) =>
      Effect.annotateCurrentSpan(
        verdict.decision === "allow"
          ? { decision: "allow" }
          : { decision: verdict.decision, rule: verdict.rule },
      ),
    ),
    Effect.withSpan("kb.guard", { attributes: { plugin: guard.owner, guard: guard.id } }),
  );
}

const verdictOf = Effect.fnUntraced(function* (
  guard: Listener<ActionGuard>,
  budgetMs: number,
  ask: (signal: AbortSignal) => Effect.Effect<GuardVerdict>,
) {
  const exit = yield* budgeted(budgetMs, ask);
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

/** Freeze `value` and everything it holds. */
function freezeDeep(value: unknown): void {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return;
  Object.freeze(value);
  for (const held of Object.values(value)) freezeDeep(held);
}

/** Every value `sealed` made: frozen all the way down already, so shared as it is. */
const SEALED = new WeakSet<object>();

/**
 * `value` as data no one can change: a copy frozen all the way down, which
 * shares nothing with whoever handed it over. A value `sealed` made is
 * returned as it is. Throws for what is not data (a function, a typed
 * array), as an action's input and a call's parts are data.
 */
function sealed<T>(value: T): T {
  if (typeof value !== "object" || value === null || SEALED.has(value)) return value;
  const copy = structuredClone(value);
  freezeDeep(copy);
  SEALED.add(copy);
  return copy;
}

/**
 * A call's invocation or action as the invoke core holds it from the
 * start (`invoke.ts`): sealed, so nothing that reads it — a listener, a
 * handler through `CurrentCall`, a nested call — can change what the
 * guards decide about, or the registry it came from. What is not data is
 * refused as the call's input.
 */
export function sealedPart<T>(value: T): Effect.Effect<T, DomainError> {
  return Effect.try({
    try: () => sealed(value),
    catch: (error) =>
      domainError(
        "invalid_input",
        `a call is data, and this one is not: ${error instanceof Error ? error.message : String(error)}`,
      ),
  });
}

/**
 * Read-only, the call and the invocation and action in it, so a listener
 * cannot change what it is asked about: each is sealed, so an assignment
 * anywhere in them throws, and a guard that throws denies.
 */
function frozen<T extends { readonly invocation: object; readonly action: object }>(value: T): T {
  return Object.freeze({
    ...value,
    invocation: sealed(value.invocation),
    action: sealed(value.action),
  });
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
  // The writes are what the commit will store, and the nodes they replace
  // are the index's own: each guard reads sealed copies, never those,
  // sealed once, inside the first guard's boundary.
  let writes: CommitCall["writes"] | undefined;
  const nodeOf = (id: NodeId) => {
    const node = call.nodeOf(id);
    return node === undefined ? undefined : sealed(node);
  };
  return askGuards(interception, call.action, ({ commit }) =>
    commit === undefined
      ? null
      : (signal) => {
          writes ??= sealed(call.writes);
          return commit(frozen({ ...call, writes, nodeOf, signal }));
        },
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

/** Run one interceptor phase, aborting the call when it fails or overruns. */
const transformOne = Effect.fnUntraced(function* (
  interceptor: Listener<ActionInterceptor>,
  budgetMs: number,
  phase: "input" | "output",
  run: (signal: AbortSignal) => Effect.Effect<unknown>,
): Effect.fn.Return<unknown, DomainError> {
  const exit = yield* budgeted(budgetMs, run).pipe(
    Effect.withSpan("kb.interceptor", {
      attributes: { plugin: interceptor.owner, interceptor: interceptor.id, phase },
    }),
  );
  const named = `interceptor ${interceptor.id} of plugin ${interceptor.owner}`;
  if (Exit.isFailure(exit)) {
    return yield* domainError(
      "internal",
      `${named} failed on the ${phase}, so the call is aborted: ${whyFailed(exit.cause)}`,
      { decidedBy: { plugin: interceptor.owner, rule: "interceptor-failed" } },
    );
  }
  if (Option.isNone(exit.value)) {
    return yield* domainError(
      "internal",
      `${named} did not transform the ${phase} within ${budgetMs} ms, so the call is aborted`,
      { decidedBy: { plugin: interceptor.owner, rule: "interceptor-timeout" } },
    );
  }
  return exit.value.value;
});

/** The input a call runs with, after every matching interceptor, in order. */
export const interceptInput = Effect.fn("kb.intercept.input")(function* (
  interception: Interception,
  call: Omit<InterceptedCall, "signal">,
) {
  let { input } = call.invocation;
  for (const interceptor of interception.interceptors(call.action)) {
    const transform = interceptor.value.input;
    if (transform === undefined) continue;
    const at: ActionInvocation = { ...call.invocation, input };
    input = yield* transformOne(interceptor, interception.budgetMs.intercept, "input", (signal) =>
      transform(frozen({ ...call, invocation: at, signal })),
    );
  }
  return { ...call.invocation, input };
});

/** The output a succeeded call answers with, after every matching interceptor, in reverse order. */
export const interceptOutput = Effect.fn("kb.intercept.output")(function* (
  interception: Interception,
  call: Omit<InterceptedCall, "signal">,
  produced: unknown,
) {
  let output = produced;
  for (const interceptor of interception.interceptors(call.action).toReversed()) {
    const transform = interceptor.value.output;
    if (transform === undefined) continue;
    const from = output;
    output = yield* transformOne(interceptor, interception.budgetMs.intercept, "output", (signal) =>
      transform(frozen({ ...call, signal }), from),
    );
  }
  return output;
});
