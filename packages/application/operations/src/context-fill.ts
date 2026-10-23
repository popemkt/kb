/**
 * What a session fills (DESIGN.md → Action registry → What a session fills):
 * the core step that gives a call made in a tab session the required inputs
 * it left out, read from what that session's person is looking at.
 *
 * It runs in the invoke core before the interceptors, so every listener, the
 * guards, the input schema and a script's grant all see the input as it will
 * run. It runs only for the outermost call: a handler's own calls and a
 * script's inherit the session for the record, and never change with where
 * the person is looking.
 */
import { Effect, Option, Predicate } from "effect";
import {
  CurrentContextReferences,
  Screens,
  type ActionDefinition,
  type ActionInvocation,
  type FilledInput,
  type PaneScreen,
  type RunningCall,
} from "@kb/contracts";
import { ActionSchemaError } from "@kb/model";

/** A call as the fill left it, and what it filled (absent when nothing). */
interface Filled {
  readonly invocation: ActionInvocation;
  readonly context?: Readonly<Record<string, FilledInput>>;
}

/** The keys a definition lets a session fill that `input` leaves out, each with its reference. */
function unfilled(def: ActionDefinition, input: unknown): readonly (readonly [string, string])[] {
  if (!Predicate.isObject(input)) return [];
  const given = new Map(Object.entries(input));
  return Object.entries(def.context ?? {}).filter(([key]) => given.get(key) === undefined);
}

/**
 * The pane a session's references read: its tab's active one, the pane the
 * person last worked in. Only a person's tab answers; a nobody's is a screen
 * any program may publish, so nothing is filled from it.
 */
const sessionPane = Effect.fnUntraced(function* (session: string) {
  const screens = yield* Effect.serviceOption(Screens);
  if (Option.isNone(screens)) return null;
  const { tabs } = yield* screens.value
    .screen({ session })
    .pipe(Effect.orElseSucceed(() => ({ tabs: [] })));
  const tab = tabs.find((shown) => shown.tab === session);
  if (tab === undefined || tab.person === null) return null;
  return tab.panes.find((pane: PaneScreen) => pane.id === tab.activePane) ?? null;
});

/**
 * Fill `made`'s declared, absent inputs from its session's active pane. A
 * given input is never replaced, and a reference that reads nothing fills
 * nothing: the input schema then refuses the call, naming what to pass.
 */
export const fillFromSession = Effect.fnUntraced(function* (
  def: ActionDefinition,
  made: ActionInvocation,
  outer: RunningCall | null,
) {
  const { input: given, session } = made;
  const missing = unfilled(def, given);
  if (
    outer !== null ||
    session === undefined ||
    !Predicate.isObject(given) ||
    missing.length === 0
  ) {
    return { invocation: made } satisfies Filled;
  }
  const pane = yield* sessionPane(session);
  if (pane === null) return { invocation: made } satisfies Filled;
  const references = yield* CurrentContextReferences;
  const context: Record<string, FilledInput> = {};
  for (const [key, from] of missing) {
    const value = references.of(from)?.resolve(pane);
    if (value !== undefined) context[key] = { from, value };
  }
  const values = Object.entries(context).map(([key, { value }]) => [key, value]);
  if (values.length === 0) return { invocation: made } satisfies Filled;
  const input = { ...given, ...Object.fromEntries(values) };
  return { invocation: { ...made, input }, context } satisfies Filled;
});

/**
 * A schema refusal of a call that left out an input a session could fill,
 * saying so: pass it, or make the call in a tab session that shows one.
 */
export function withContextHint(
  def: ActionDefinition,
  invocation: ActionInvocation,
  references: { readonly of: (id: string) => { readonly description: string } | undefined },
) {
  return (err: ActionSchemaError): ActionSchemaError => {
    const missing = unfilled(def, invocation.input);
    if (missing.length === 0) return err;
    const where = invocation.session === undefined ? "a tab session" : "the session's tab";
    const hints = missing.map(
      ([key, from]) =>
        `${key} is required; pass it, or have ${references.of(from)?.description ?? from} in ${where}`,
    );
    return new ActionSchemaError(`${err.message} (${hints.join("; ")})`, err.issues);
  };
}
