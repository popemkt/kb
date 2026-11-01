import type { NodeIndex } from "@kb/query";
import { Effect, Predicate } from "effect";
import {
  type ActionDefinition,
  type ActionEffectHandler,
  type ActionHandlerEnv,
  type IsomorphicActionEnv,
  type ActionInvocation,
  type ActionReceipt,
  failed,
  succeeded,
  type ExtensionPromiseHandler,
  type KbContext,
  CurrentCall,
  CurrentContextReferences,
  CurrentInterception,
  approvalSubject,
} from "@kb/contracts";
import {
  ActionSchemaError,
  FailureCodeSchema,
  ResolveError,
  ensureDomainError,
  isDomainError,
  domainError,
  isZodError,
  parseBySchema,
  receiptCodeOf,
  type DomainError,
} from "@kb/model";
import {
  guardBefore,
  interceptInput,
  interceptOutput,
  refusalOf,
  sealedPart,
} from "./interception.ts";
import { callWithin, scriptRefusal } from "./script-reach.ts";
import { fillFromSession, withContextHint } from "./context-fill.ts";
import { assetUploadDef, assetUploadEffect } from "./assets.ts";
import {
  sandboxTrustDef,
  sandboxTrustEffect,
  sandboxTrustedDef,
  sandboxTrustedEffect,
  sandboxUntrustDef,
  sandboxUntrustEffect,
} from "./trust.ts";
import {
  fieldDefineDef,
  fieldDefineEffect,
  graphQueryDef,
  graphQueryEffect,
  graphRunDef,
  graphRunEffect,
  graphSearchDef,
  graphSearchEffect,
  graphChangesDef,
  graphChangesEffect,
  nodeAddDef,
  nodeAddEffect,
  nodeDeleteDef,
  nodeDeleteEffect,
  nodeGetDef,
  nodeGetEffect,
  nodeUpdateDef,
  nodeUpdateEffect,
  tagDefineDef,
  tagDefineEffect,
} from "./actions.ts";
import {
  extensionFootprintDef,
  extensionFootprintEffect,
  extensionListDef,
  extensionListEffect,
  extensionSettingsDef,
  extensionSettingsEffect,
  extensionSwitchDef,
  extensionSwitchEffect,
} from "./extensions.ts";
import { nodeAddTreeDef, nodeAddTreeEffect } from "./node-add-tree.ts";
import { kbManifestDef, kbManifestEffect } from "./manifest.ts";
import { viewsMigrateDef, viewsMigrateEffect } from "./views-migrate.ts";
import { viewProposeDef, viewProposeEffect } from "./view-propose.ts";
import { viewOpeningsDef, viewOpeningsEffect } from "./view-openings.ts";
import { ontologyMembersDef, ontologyMembersEffect } from "./ontology.ts";
import {
  renderViewActionEffect,
  renderViewDef,
  renderViewsActionEffect,
  renderViewsDef,
} from "./render.ts";
import {
  uiCaptureDef,
  uiCaptureEffect,
  uiNavigateDef,
  uiNavigateEffect,
  uiScreenDef,
  uiScreenEffect,
  uiSelectDef,
  uiSelectEffect,
} from "./ui.ts";

/**
 * The invoke core: one registered-action shape, the core actions
 * paired with their handlers beside the definitions that own them, and the
 * one place a parsed input meets a handler and a failure becomes a receipt.
 * Runtime (server, CLI, MCP) composes this over its discovered registry; the
 * browser composes it over `coreActions` alone. Neither owns a second copy.
 */
export interface RegisteredAction<R = ActionHandlerEnv> {
  def: ActionDefinition;
  /**
   * Effect-native handler. Preferred when set — composed directly inside
   * {@link invokeEffect} (no `tryPromise`).
   */
  effect?: ActionEffectHandler<R>;
  /**
   * Legacy Promise handler. Used only when {@link RegisteredAction.effect}
   * is absent (third-party `.kb/extensions`).
   */
  handler?: ExtensionPromiseHandler;
  /** "core" | "ext:<name>" */
  source: string;
  aliases: readonly string[];
}

function coreNative<R>(def: ActionDefinition, effect: ActionEffectHandler<R>): RegisteredAction<R> {
  return { def, effect, source: "core", aliases: [] };
}

/** The actions every runtime can run from its own store and index. */
export const isomorphicActions: readonly RegisteredAction<IsomorphicActionEnv>[] = [
  coreNative(nodeAddDef, nodeAddEffect),
  coreNative(nodeAddTreeDef, nodeAddTreeEffect),
  coreNative(nodeUpdateDef, nodeUpdateEffect),
  coreNative(nodeDeleteDef, nodeDeleteEffect),
  coreNative(nodeGetDef, nodeGetEffect),
  coreNative(fieldDefineDef, fieldDefineEffect),
  coreNative(tagDefineDef, tagDefineEffect),
  coreNative(graphQueryDef, graphQueryEffect),
  coreNative(graphSearchDef, graphSearchEffect),
  coreNative(graphChangesDef, graphChangesEffect),
  coreNative(ontologyMembersDef, ontologyMembersEffect),
  coreNative(viewProposeDef, viewProposeEffect),
  coreNative(viewOpeningsDef, viewOpeningsEffect),
];

/**
 * The actions that reach a service only the invoke tip's composition root can
 * provide: a workspace port (saved queries, views, assets, code trust), the registry's
 * own catalogs (actions, views, extensions), or the screens of the UI tabs.
 */
const portActions: readonly RegisteredAction[] = [
  coreNative(graphRunDef, graphRunEffect),
  coreNative(assetUploadDef, assetUploadEffect),
  coreNative(renderViewDef, renderViewActionEffect),
  coreNative(renderViewsDef, renderViewsActionEffect),
  coreNative(kbManifestDef, kbManifestEffect),
  coreNative(extensionSwitchDef, extensionSwitchEffect),
  coreNative(extensionFootprintDef, extensionFootprintEffect),
  coreNative(extensionListDef, extensionListEffect),
  coreNative(extensionSettingsDef, extensionSettingsEffect),
  coreNative(viewsMigrateDef, viewsMigrateEffect),
  coreNative(uiScreenDef, uiScreenEffect),
  coreNative(uiNavigateDef, uiNavigateEffect),
  coreNative(uiSelectDef, uiSelectEffect),
  coreNative(uiCaptureDef, uiCaptureEffect),
  coreNative(sandboxTrustDef, sandboxTrustEffect),
  coreNative(sandboxUntrustDef, sandboxUntrustEffect),
  coreNative(sandboxTrustedDef, sandboxTrustedEffect),
];

export const coreActions: readonly RegisteredAction[] = [...isomorphicActions, ...portActions];

/** Extensions shipped with kb itself; loaded like repo extensions. */

export function isEffectNativeAction(action: RegisteredAction): boolean {
  return typeof action.effect === "function";
}

/**
 * An extension's `effect` handler may be authored outside kb, so its declared
 * {@link ActionHandlerError} is a promise the module boundary cannot verify.
 * This is the runtime half of that promise: a failure outside the vocabulary
 * becomes an `internal` DomainError instead of escaping as a defect.
 */
function mapHandlerError(err: unknown): ActionSchemaError | DomainError {
  if (err instanceof ActionSchemaError) return err;
  return ensureDomainError(err);
}

/**
 * The one place a parsed input meets a handler that declared its own input
 * type. `(input: never)` is the standard encoding for "accepts whatever this
 * action's `inputSchema` produces", and `parsed` is what that very schema just
 * produced. No runtime check can see a contributed handler's signature (the
 * SDK's surface types it, and the kernel takes the plugin as written), so
 * the two are joined here once rather than asserted at each call site.
 */
function asDeclaredInput(parsed: unknown): never {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the one sanctioned boundary trust: the SDK types the shape, the registry joins it to the handler signature here, once
  return parsed as never;
}

/** Pair an action's handler with its parsed input; `null` when it has neither. */
function dispatch<R>(
  entry: RegisteredAction<R>,
  ctx: KbContext<NodeIndex>,
  parsed: unknown,
): Effect.Effect<unknown, ActionSchemaError | DomainError, R> | null {
  const { effect, handler } = entry;
  if (effect) {
    return Effect.scoped(effect(asDeclaredInput(parsed))).pipe(Effect.mapError(mapHandlerError));
  }
  if (handler) {
    return Effect.tryPromise({
      try: () => handler(ctx, asDeclaredInput(parsed)),
      catch: mapHandlerError,
    });
  }
  return null;
}

/**
 * A result that does not match its own `outputSchema` is a broken contract on
 * kb's side, not a caller error: the manifest published that shape and a
 * surface is about to publish a success receipt claiming it. So the same
 * parser runs on the way out, and a mismatch becomes an `internal` failure
 * carrying the schema's issues — a typed receipt, never a throw across the
 * boundary.
 *
 * The parsed value is what the receipt carries. Parsing that did not decide
 * the output would be a check performed and then discarded.
 */
const parseOutput = Effect.fnUntraced(function* (def: ActionDefinition, output: unknown) {
  return yield* parseBySchema(def.outputSchema, output).pipe(
    Effect.mapError((err) =>
      domainError(
        "internal",
        `action ${def.id} returned output its schema rejects: ${err.message}`,
        {
          action: def.id,
          issues: err instanceof ActionSchemaError ? err.issues : undefined,
        },
      ),
    ),
  );
});

/**
 * How deep calls may nest, each made inside another (an action's handler
 * invoking, or a listener's): past it the call is refused, so a listener
 * or an action that calls back into what it intercepts cannot run away.
 */
export const MAX_CALL_DEPTH = 16;

/**
 * Effect invoke over a registry map — failures stay typed until a receipt mapper takes them.
 * Native handlers are composed directly (scoped); legacy Promise handlers are
 * the only path that uses `tryPromise`.
 */
export const invokeWith = Effect.fn("kb.invoke")(function* <R>(
  actions: ReadonlyMap<string, RegisteredAction<R>>,
  ctx: KbContext<NodeIndex>,
  asked: ActionInvocation,
): Effect.fn.Return<ActionReceipt, ActionSchemaError | DomainError, R> {
  // A call an action makes while another runs is made as that one's caller.
  const outer = yield* CurrentCall;
  const made = callWithin(outer, asked);
  const { id } = made;
  const depth = (outer?.depth ?? 0) + 1;
  if (depth > MAX_CALL_DEPTH) {
    return failed(id, "internal", `calls nest deeper than ${MAX_CALL_DEPTH}; ${id} is refused`, {
      depth,
    });
  }
  const entry = actions.get(id);
  if (!entry) return failed(id, "unknown_action", `unknown action: ${id}`);
  // Every call passes the interceptors, then is put to the guards as it will
  // run, here on invoke itself, so no surface can skip either
  // (`interception.ts`).
  // The call is held as sealed data from here on (`sealedPart`): what the
  // guards decide about is what runs, and no reader of it — a listener,
  // a handler through `CurrentCall`, a nested call — can change it, or the
  // registry's definition its action came from.
  const action = yield* sealedPart(
    approvalSubject(entry.def, (part) => actions.get(part)?.def.mode),
  );
  // A call made in a tab session is first given the required inputs it left
  // out from what its person is looking at, so all that follows sees the
  // input as it will run (`context-fill.ts`).
  const fill = yield* fillFromSession(entry.def, made, outer);
  const held = yield* sealedPart(fill.invocation);
  // Everything the call runs — its listeners as much as its handler — runs
  // as this call, so a call any of them makes nests in it and counts
  // toward the depth limit.
  const asCall = (as: ActionInvocation) =>
    Effect.provideService(CurrentCall, Object.freeze({ invocation: as, action, depth }));
  const interception = yield* CurrentInterception;
  const invocation = yield* interceptInput(interception, { ctx, invocation: held, action }).pipe(
    Effect.flatMap(sealedPart),
    asCall(held),
  );
  const { input } = invocation;
  const outcome = yield* guardBefore(interception, {
    ctx,
    invocation,
    action,
    phase: "invoke",
  }).pipe(asCall(invocation));
  const refusal = refusalOf(outcome, invocation);
  if (refusal !== null) return failed(id, refusal.code, refusal.message, refusal.details);

  const hinted = withContextHint(entry.def, invocation, yield* CurrentContextReferences);
  const parsed = yield* parseBySchema(entry.def.inputSchema, input).pipe(
    Effect.mapError((err) => (err instanceof ActionSchemaError ? hinted(err) : err)),
  );
  const outOfReach = scriptRefusal(entry.def, invocation, parsed, ctx);
  if (outOfReach !== null) return failed(id, "forbidden", outOfReach.message, outOfReach.details);
  const run = dispatch(entry, ctx, parsed);
  if (run === null) return failed(id, "internal", `action has no effect or handler: ${id}`);

  const produced = yield* run.pipe(asCall(invocation));
  const output = yield* interceptOutput(interception, { ctx, invocation, action }, produced).pipe(
    asCall(invocation),
  );
  return succeeded(id, yield* parseOutput(entry.def, output), fill.context);
});

/**
 * Effect invoke that always succeeds with an {@link ActionReceipt}.
 * Surfaces compose this inside Effect programs; typed failures from
 * {@link invokeWith} are mapped through the canonical receipt mapper.
 * Requires {@link ActionHandlerEnv} so native handlers receive Layers.
 */
export const invokeReceiptWith = Effect.fn("kb.invokeReceipt")(function* <R>(
  actions: ReadonlyMap<string, RegisteredAction<R>>,
  ctx: KbContext<NodeIndex>,
  invocation: ActionInvocation,
): Effect.fn.Return<ActionReceipt, never, R> {
  return yield* invokeWith(actions, ctx, invocation).pipe(
    Effect.catch((err) => Effect.succeed(receiptFromError(invocation.id, err))),
  );
});

export function receiptFromError(id: string, err: unknown): ActionReceipt {
  if (err instanceof ActionSchemaError) {
    return failed(id, "invalid_input", err.message, err.issues);
  }
  if (isZodError(err)) {
    return failed(id, "invalid_input", err.message, err.issues);
  }
  if (isDomainError(err)) {
    return failed(id, receiptCodeOf(err), err.message, err.details);
  }
  if (err instanceof ResolveError) {
    return failed(id, receiptCodeOf(err), err.message, err.details);
  }
  if (err instanceof Error) {
    // DocsError and extension errors alike: any Error carrying a valid
    // FailureCode `code` maps to a typed failure.
    const parsed = FailureCodeSchema.safeParse(
      Predicate.hasProperty(err, "code") ? err.code : undefined,
    );
    if (parsed.success) {
      const details = Predicate.hasProperty(err, "details") ? err.details : undefined;
      return failed(id, parsed.data, err.message, details);
    }
    return failed(id, "internal", err.message);
  }
  return failed(id, "internal", String(err));
}
