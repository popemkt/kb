import { Context, Effect } from "effect";
import { Point, type PluginContext, type PluginError } from "@kb/plugin";
import type { NodeId, NodeLike, NodeWrite } from "@kb/model";
import type { ActionInvocation } from "./actions.ts";
import type { CalledAction } from "./approval.ts";
import type { KbContext } from "./session.ts";

/**
 * The invoke core's interception points (`DESIGN.md` → Action registry →
 * Interception): where a plugin takes part in every call without the core
 * naming it. There are two kinds, and they are kept apart so that policy
 * cannot ride inside a transform:
 *
 * - a **guard** decides — allow, ask, or deny — and cannot change the call;
 *   it is asked before the action runs and again before its commit, with
 *   the commit's actual writes. A guard that fails or overruns its budget
 *   denies.
 * - an **interceptor** transforms — the call's input before it runs, its
 *   output after — and cannot refuse it. One that fails aborts the call.
 *
 * Each names the calls it is for with a `match` (an action id, a pattern
 * with `*`, or a mode word: `matchSpecificity` in `@kb/model`).
 */

/** What a guard decides about a call. */
export type GuardVerdict =
  | { readonly decision: "allow" }
  | {
      readonly decision: "ask" | "deny";
      /** The rule that decided, in the guard's own terms (a policy id, `mode`, …). */
      readonly rule: string;
      readonly message: string;
      /** What the refusal carries to its caller beside who decided. */
      readonly details?: Readonly<Record<string, unknown>>;
    };

/** A call as a guard is asked about it: everything it may read, nothing it may change. */
export interface GuardCall {
  /** The session the call runs in. */
  readonly ctx: KbContext;
  /** The invocation as it will run (after every interceptor), made by its actor. */
  readonly invocation: ActionInvocation;
  /** The action it invokes, with its mode and a batch's parts. */
  readonly action: CalledAction;
  /**
   * `invoke` for a call about to run; `list` when a surface asks what would
   * be decided about its caller's call, to list the action (`kb.manifest`),
   * where there is no input.
   */
  readonly phase: "list" | "invoke";
  /** Aborted when the call is interrupted or the guard's budget runs out. */
  readonly signal: AbortSignal;
}

/** A call as a guard is asked about its commit: the call, and the nodes it writes. */
export interface CommitCall extends Omit<GuardCall, "phase"> {
  readonly writes: readonly NodeWrite[];
  /** How the writes' fields, kinds and named nodes are read: the graph before the commit. */
  readonly nodeOf: (id: NodeId) => NodeLike | undefined;
}

/** What a plugin contributes to {@link ActionGuardPoint}. */
export interface ActionGuard {
  /** The calls it is asked about. */
  readonly match: string;
  /** Asked before the action runs (and when it is listed). Absent: it allows. */
  readonly before?: (call: GuardCall) => Effect.Effect<GuardVerdict>;
  /** Asked before the call commits, with what it writes. Absent: it allows. */
  readonly commit?: (call: CommitCall) => Effect.Effect<GuardVerdict>;
}

/** A call as an interceptor sees it. */
export interface InterceptedCall {
  readonly ctx: KbContext;
  readonly invocation: ActionInvocation;
  readonly action: CalledAction;
  readonly signal: AbortSignal;
}

/** What a plugin contributes to {@link ActionInterceptorPoint}. */
export interface ActionInterceptor {
  /** The calls it transforms. */
  readonly match: string;
  /** The input the call runs with, from the input it was given. */
  readonly input?: (call: InterceptedCall) => Effect.Effect<unknown>;
  /** The output a succeeded call answers with, from the output it produced. */
  readonly output?: (call: InterceptedCall, output: unknown) => Effect.Effect<unknown>;
}

/** The guards plugins contribute. Every one that matches is asked; the strictest verdict holds. */
export const ActionGuardPoint = Point<ActionGuard>()("action/guard");

/** The interceptors plugins contribute, run in order on the input and in reverse on the output. */
export const ActionInterceptorPoint = Point<ActionInterceptor>()("action/intercept");

/** One listener as the invoke core runs it: what it is, and the plugin that contributed it. */
export interface Listener<L> {
  readonly owner: string;
  readonly id: string;
  readonly value: L;
}

/**
 * The listeners a session's calls go through, as the invoke core reads
 * them: the ones matching an action, in order (each plugin's dependencies'
 * first, then load order), and whether every guard the deployment requires
 * is there to ask.
 */
export interface Interception {
  readonly guards: (action: CalledAction) => readonly Listener<ActionGuard>[];
  readonly interceptors: (action: CalledAction) => readonly Listener<ActionInterceptor>[];
  /**
   * The plugins whose guards the deployment requires and that are not
   * applied right now (loading, failed, or going): while any is, every call
   * is denied rather than run unguarded.
   */
  readonly missing: () => readonly string[];
  /** How long a guard may take to answer, and an interceptor to transform, before it fails. */
  readonly budgetMs: { readonly guard: number; readonly intercept: number };
}

/** The guard and interceptor budgets when a host sets none. */
export const DEFAULT_BUDGET_MS = { guard: 2000, intercept: 2000 } as const;

/** No listeners: every call proceeds as made. */
export const NO_INTERCEPTION: Interception = {
  guards: () => [],
  interceptors: () => [],
  missing: () => [],
  budgetMs: DEFAULT_BUDGET_MS,
};

/** Where the invoke core and the commit read the session's listeners: none unless a host provides them. */
export const CurrentInterception = Context.Reference<Interception>("kb/CurrentInterception", {
  defaultValue: () => NO_INTERCEPTION,
});

/**
 * Guard the calls `match` names: `before` decides about each call before it
 * runs, `commit` (when given) about what it is about to write. The plugin
 * that calls it owns the guard, which goes when the plugin does. `id` tells
 * two guards of one plugin apart; it defaults to the match.
 */
export function guardAction(
  plugin: PluginContext,
  match: string,
  guard: Omit<ActionGuard, "match">,
  id: string = match,
): Effect.Effect<void, PluginError> {
  return plugin
    .contribute(ActionGuardPoint, { id, value: { ...guard, match } })
    .pipe(Effect.asVoid);
}

/**
 * Transform the calls `match` names: `input` gives the input each runs
 * with, `output` the output a succeeded one answers with. The plugin that
 * calls it owns the interceptor. `id` defaults to the match.
 */
export function onAction(
  plugin: PluginContext,
  match: string,
  hooks: Omit<ActionInterceptor, "match">,
  id: string = match,
): Effect.Effect<void, PluginError> {
  return plugin
    .contribute(ActionInterceptorPoint, { id, value: { ...hooks, match } })
    .pipe(Effect.asVoid);
}
