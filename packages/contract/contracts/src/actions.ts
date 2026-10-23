import { Context, Predicate, type Effect } from "effect";
import type { FileSystem } from "effect/FileSystem";
import { z } from "zod";
import {
  FailureCodeSchema,
  type Actor,
  type ActionSchema,
  type ActionSchemaError,
  type CodedError,
  type FailureCode,
  schemaToJsonSchema,
  present,
} from "@kb/model";
import type { KbIndexService, QueryEngineService } from "@kb/query";
import type { Screens } from "./screen.ts";
import { NO_CONTEXT, type ContextReferences } from "./context.ts";
import type { GraphWrites } from "./graph-writes.ts";
import type { KbCtx, KbStore } from "./session.ts";
import type { TemplateRegistry } from "./template.ts";
import type { ExtensionCatalog } from "./declaration.ts";
import type { ExtensionFailures } from "./extension-report.ts";
import type { FamilyKernels } from "./footprint.ts";
import type { ViewCatalog } from "./view-catalog.ts";
import type { Assets, CodeTrust, LegacyDocsViews, SavedQueries } from "./workspace.ts";
import type { KbRoots } from "./roots.ts";

/**
 * What invoking an action does, declared once on its definition and read by
 * every surface: a `read` changes nothing, and a `write` may change the graph,
 * the workspace, or what a UI tab shows. A write can also declare approval:
 * `"required"`, a person must approve each call, or `"delegated"`, the
 * owner's own calls need no approval and anyone acting for them does. Core
 * decides nothing by it: a declaration is what a guard may read (the
 * governance family's `declaredDecision`), and while that family contributes
 * no guard every call runs (DESIGN.md → Action registry → Current stance).
 * Every surface still shows it ({@link requiresApproval}). Approval exists
 * only on a write, so it is part of the write arm and not a flag beside the
 * mode.
 *
 * An action touches its own kb root and nothing else, unless its mode says
 * `outsideRoot`: it reaches past the root, to another store on this machine
 * or a process it starts. Either kind can, so it sits on both arms.
 *
 * The extension loader decodes a contribution's mode through
 * {@link isActionMode}. The SDK's `ActionMode` restates it for authors, and a
 * type-level test keeps the two equal.
 */
const ActionModeSchema = z.discriminatedUnion("kind", [
  // Strict, so a read that claims an approval is rejected, not stripped.
  z.strictObject({ kind: z.literal("read"), outsideRoot: z.literal(true).optional() }),
  z.strictObject({
    kind: z.literal("write"),
    approval: z.enum(["required", "delegated"]).optional(),
    outsideRoot: z.literal(true).optional(),
  }),
]);
export type ActionMode = z.infer<typeof ActionModeSchema>;

export function isActionMode(value: unknown): value is ActionMode {
  return ActionModeSchema.safeParse(value).success;
}

/** True when an action with this mode declares that each call needs a person's approval. */
export function requiresApproval(mode: ActionMode): boolean {
  return mode.kind === "write" && mode.approval === "required";
}

/**
 * The input schema a surface publishes for an action's tool. MCP and WebMCP
 * both need a JSON Schema whose root is an object, so an action whose schema
 * is anything else is published as an object that takes no properties. An
 * input a tab session may fill (`ManifestEntry.context`) says so in its
 * description, and on a surface whose calls are made in a session
 * (`sessioned`) it is no longer required: the agent may leave it out. One
 * rule, so every surface shows an agent the same schema for the same action.
 */
export function toolInputSchema(
  entry: Pick<ManifestEntry, "inputSchema" | "context">,
  sessioned = false,
): { readonly type: "object" } & Record<string, unknown> {
  const { inputSchema } = entry;
  if (!Predicate.isObject(inputSchema) || inputSchema.type !== "object") {
    return { type: "object" as const, properties: {} };
  }
  const schema = { ...inputSchema, type: "object" as const };
  const context = new Map(Object.entries(entry.context ?? {}));
  const { properties, required } = inputSchema;
  if (context.size === 0 || !Predicate.isObject(properties)) return schema;
  const noted = Object.entries(properties).map(([key, property]) => {
    const fill = context.get(key);
    if (fill === undefined || !Predicate.isObject(property)) return [key, property];
    const note = sessioned
      ? `Left out, it is ${fill.description} in the call's tab session.`
      : `A call made in a tab session may leave it out for ${fill.description}.`;
    const said = typeof property.description === "string" ? `${property.description}. ` : "";
    return [key, { ...property, description: `${said}${note}` }];
  });
  const stillRequired = Array.isArray(required)
    ? required.filter((key) => !sessioned || !context.has(String(key)))
    : required;
  return {
    ...schema,
    properties: Object.fromEntries(noted),
    ...(stillRequired === undefined ? {} : { required: stillRequired }),
  };
}

/**
 * Services a native action handler may require. Provided as one merged Layer
 * at the invoke tip (`kbRuntimeLayer`); a handler that needs fewer of them
 * still assigns, because Effect's requirement channel is covariant.
 */
export type ActionHandlerEnv =
  | KbCtx
  | KbStore
  | GraphWrites
  | KbIndexService
  | QueryEngineService
  | FileSystem
  | TemplateRegistry
  | ActionCatalog
  | ViewCatalog
  | ExtensionCatalog
  | ExtensionFailures
  | FamilyKernels
  | SavedQueries
  | LegacyDocsViews
  | Assets
  | CodeTrust
  | KbRoots
  | Screens;

/**
 * What an action handler may fail with. A closed vocabulary, not `unknown`:
 * every surface turns a failure into an {@link ActionReceipt}, and a receipt
 * needs a {@link FailureCode} — so a handler either fails with a schema
 * failure or with an error that names its code. `DomainError` and a bundled
 * extension's own error class both satisfy `CodedError`. Anything outside the
 * vocabulary is a defect; the one place an untyped handler crosses into this
 * channel is the extension module boundary, and `@kb/runtime`'s registry maps
 * it there.
 */
export type ActionHandlerError = ActionSchemaError | CodedError;

/**
 * Effect-native action handler. Input is already schema-parsed; the services
 * in {@link ActionHandlerEnv} come from Layers at the invoke tip.
 *
 * `input: never` is the standard encoding for "accepts whatever this action's
 * `inputSchema` produces": a handler declaring a concrete input type is
 * assignable, and the registry pairs the two at the one seam that knows both.
 */
export type ActionEffectHandler<R = ActionHandlerEnv> = (
  input: never,
) => Effect.Effect<unknown, ActionHandlerError, R>;

/**
 * The services every runtime can supply from its own store, node set and
 * query engine, and
 * the view catalog it reads off its own kernel — no filesystem, no workspace
 * ports. An action whose handler requires only these
 * runs identically in the browser and on the server; the list of such actions
 * is `isomorphicActions` in `@kb/operations`, typed with this env so a
 * composition root that has nothing more can provide it without lying.
 */
export type IsomorphicActionEnv = KbCtx | KbStore | QueryEngineService | ViewCatalog;

/**
 * Action contract. Schemas are Standard Schema v1–compatible (zod 4 satisfies
 * this). JSON Schema for manifests is derived when the vendor is zod;
 * otherwise a permissive object schema is emitted.
 *
 * Built-ins / bundled extensions may set {@link ActionDefinition.effect};
 * third-party `.kb/extensions` keep a Promise `handler` (see ExtensionAction).
 * Manifest serialization ignores both handler fields.
 */
export interface ActionDefinition<
  TIn extends ActionSchema = ActionSchema,
  TOut extends ActionSchema = ActionSchema,
> {
  id: string;
  title: string;
  description: string;
  mode: ActionMode;
  /**
   * The ids of the actions every call of this one is a batch of: it writes
   * what they write, so approval decides it as each of them as well as
   * itself, and the stricter decision holds (`resolveApproval`). Only ids:
   * each part's mode is its own definition's, and the registry resolves it
   * ({@link batchPartsOf}). Declared by the action, never inferred.
   */
  batchOf?: readonly string[];
  /**
   * The keys of its input whose values are the nodes a call acts on, read
   * or written: an id, a list of ids, or null for the outline's root. A
   * script's call reaches only nodes its subject holds, so a script may call
   * an action only when it declares them, and only with a call that names
   * one (DESIGN.md → Sandbox → Grants). Declared by the action, never
   * inferred.
   */
  targets?: readonly string[];
  /**
   * The required keys of its input a call made in a tab session may leave
   * out, each with the context reference that fills it from what the
   * session's person is looking at (`ContextReference`): `{ canvasId:
   * "ext.canvas.open" }`. Only required keys, so a call that works without a
   * session means the same with one; the registry refuses any other
   * (DESIGN.md → Action registry → What a session fills). Declared by the
   * action, never inferred.
   */
  context?: Readonly<Record<string, string>>;
  inputSchema: TIn;
  outputSchema: TOut;
  /**
   * Effect-native handler. When present, the registry composes it directly
   * (scoped) and never lifts it through `tryPromise`.
   */
  effect?: ActionEffectHandler;
}

/**
 * The invocation envelope every surface that receives one as data decodes
 * through: the HTTP body of `POST /api/action` and the JSON of
 * `kb action-invoke`. A surface that builds invocations itself (MCP maps a
 * tool call, the CLI's verbs plan one) constructs this same shape. An absent
 * or `null` input is the empty input.
 *
 * `approved` is the statement that a person approved this call: the answer
 * to a guard that asks (`approval_required`). It sits on the envelope, not in
 * the input, because it is about the call and not an argument to the action.
 * It survives only on a wire that carries approval (`onWire`): the page's,
 * `kb action-invoke`'s. An MCP tool call has no envelope, its arguments being
 * the input, and a local program's HTTP request has no person behind it, so
 * there a call a guard asks about stays refused.
 *
 * `session` is the tab session the call is made in (DESIGN.md → Action
 * registry → The tab session): a tab's name, which proves nothing and grants
 * nothing, so every wire carries it. A call made in a session is about what
 * that tab shows; one that names none is made in no tab.
 *
 * `script` is a script's reach. A request never says who makes it: the
 * surface it arrives on does (`onWire`), so the envelope has no actor, and a
 * caller that sends one anyway has it dropped, never refused. A script's
 * reach survives only on a wire that relays calls others make (the page's,
 * kb's own in process), and is dropped on any other. What reaches the invoke
 * core is an {@link ActionInvocation}, which always names who makes it, the
 * author its transaction records.
 */
export const ActionRequestSchema = z.object({
  id: z.string().min(1),
  input: z
    .unknown()
    .optional()
    .transform((input): unknown => input ?? {}),
  approved: z.boolean().optional(),
  session: z.string().min(1).optional(),
  /**
   * A script's call: what its run may reach — the node it runs for and its
   * grant — stamped by the host that answers the guest (`answerToolCall`)
   * on the call its wire made, never by the guest. The invoke core decides
   * the call against it.
   */
  script: z.object({ subject: z.string().nullable(), grant: z.unknown() }).optional(),
});
/** A call as a caller states it: who makes it is the surface's to say. */
export type ActionRequest = z.output<typeof ActionRequestSchema>;

/**
 * The request `raw` makes, a call's envelope as it arrives from outside kb
 * (an HTTP body, `kb action-invoke`'s JSON), or why it is no request. It is
 * never refused for what it states: the surface it arrives on says who makes
 * it (`onWire`), and what that wire does not carry is dropped.
 */
export function requestOf(
  raw: unknown,
): { readonly request: ActionRequest } | { readonly invalid: string } {
  const parsed = ActionRequestSchema.safeParse(raw);
  return parsed.success
    ? { request: parsed.data }
    : { invalid: parsed.error.issues.map((issue) => issue.message).join("; ") };
}

/**
 * The envelope `call` is sent in to another process: the request alone. Who
 * made it here stays here, since the surface that receives it says who
 * calls there.
 */
export function envelopeOf(call: ActionRequest): ActionRequest {
  const { id, input, approved, session, script } = call;
  return {
    id,
    input,
    ...(approved === undefined ? {} : { approved }),
    ...(session === undefined ? {} : { session }),
    ...(script === undefined ? {} : { script }),
  };
}

/**
 * The `_meta` key a call over a protocol whose arguments are the input (an
 * MCP `tools/call`) names its tab session under: that protocol's own
 * envelope, so the input stays the action's.
 */
export const SESSION_META_KEY = "kb/session";

const SessionMetaSchema = z.object({ [SESSION_META_KEY]: z.string().min(1) });

/** The tab session a call's `_meta` names, if it names one. */
export function sessionOfMeta(meta: unknown): string | undefined {
  const parsed = SessionMetaSchema.safeParse(meta);
  return parsed.success ? parsed.data[SESSION_META_KEY] : undefined;
}

/**
 * A call as it reaches the invoke core: a request with who makes it, which
 * the surface it arrived on stamps (`onWire`) and every call made while
 * another runs takes from it, so no call reaches the core without an actor.
 * The actor is a record of who made the call (`KbTx.actor`), and grants
 * nothing by itself; only a script's call is held to more (`madeByScript`).
 */
export type ActionInvocation = ActionRequest & { readonly actor: Actor };

/** One input a session filled: the reference it was read from, and the value it read. */
export const FilledInputSchema = z.object({ from: z.string(), value: z.unknown() });
export type FilledInput = z.infer<typeof FilledInputSchema>;

export const SucceededReceiptSchema = z.object({
  status: z.literal("succeeded"),
  id: z.string(),
  output: z.unknown(),
  /**
   * The inputs the call's tab session filled, by key: what "this" meant
   * (`ActionDefinition.context`). Absent when it filled none.
   */
  context: z.record(z.string(), FilledInputSchema).optional(),
});

export const FailedReceiptSchema = z.object({
  status: z.literal("failed"),
  id: z.string(),
  code: FailureCodeSchema,
  message: z.string(),
  details: z.unknown().optional(),
});

export const ActionReceiptSchema = z.discriminatedUnion("status", [
  SucceededReceiptSchema,
  FailedReceiptSchema,
]);
export type ActionReceipt = z.infer<typeof ActionReceiptSchema>;

export function succeeded(
  id: string,
  output: unknown,
  context?: Readonly<Record<string, FilledInput>>,
): ActionReceipt {
  return context === undefined
    ? { status: "succeeded", id, output }
    : { status: "succeeded", id, output, context: { ...context } };
}

export function failed(
  id: string,
  code: FailureCode,
  message: string,
  details?: unknown,
): ActionReceipt {
  return { status: "failed", id, code, message, details };
}

/**
 * One published action: its definition without the handlers, with both
 * schemas as JSON Schema. Every surface lists actions as these entries.
 */
export const ManifestEntrySchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  mode: ActionModeSchema,
  /** The actions this one is a batch of, each with its own mode ({@link batchPartsOf}). */
  batchOf: z.array(z.object({ id: z.string(), mode: ActionModeSchema })).optional(),
  inputSchema: z.unknown(),
  outputSchema: z.unknown(),
  /**
   * The required inputs a call made in a tab session may leave out, each
   * with the reference that fills it and what that is on a pane
   * (`ActionDefinition.context`).
   */
  context: z
    .record(z.string(), z.object({ reference: z.string(), description: z.string() }))
    .optional(),
  /** Present when this id is a compat alias for another registered id. */
  aliasOf: z.string().optional(),
});
export type ManifestEntry = z.infer<typeof ManifestEntrySchema>;

/** One action a batch is a batch of, as approval weighs it: its id and its own declared mode. */
export interface BatchPart {
  readonly id: string;
  readonly mode: ActionMode;
}

/** A registered action's mode by id, as the registry that holds it answers. */
export type ModeOf = (id: string) => ActionMode | undefined;

/**
 * The parts a definition declares itself a batch of, each with the mode its
 * own definition states, read from the registry they are registered in. The
 * registry refuses to register a batch whose part it does not hold, so a
 * part is always found here.
 */
function batchPartsOf(
  def: Pick<ActionDefinition, "id" | "batchOf">,
  modeOf: ModeOf,
): BatchPart[] | undefined {
  return def.batchOf?.map((id) => ({
    id,
    mode: present(modeOf(id), `${def.id} is a batch of ${id}, which the registry holds`),
  }));
}

/** An action as approval weighs a call to it: its id, its mode, and its batch's parts. */
export function approvalSubject(def: ActionDefinition, modeOf: ModeOf) {
  const parts = batchPartsOf(def, modeOf);
  return { id: def.id, mode: def.mode, ...(parts === undefined ? {} : { batchOf: parts }) };
}

export function actionToManifestEntry(
  def: ActionDefinition,
  modeOf: ModeOf,
  references: ContextReferences = NO_CONTEXT,
): ManifestEntry {
  const parts = batchPartsOf(def, modeOf);
  const context = Object.entries(def.context ?? {}).map(([key, reference]) => [
    key,
    { reference, description: references.of(reference)?.description ?? reference },
  ]);
  return {
    id: def.id,
    title: def.title,
    description: def.description,
    mode: def.mode,
    ...(parts === undefined ? {} : { batchOf: parts }),
    inputSchema: schemaToJsonSchema(def.inputSchema, "input"),
    outputSchema: schemaToJsonSchema(def.outputSchema, "output"),
    ...(context.length === 0 ? {} : { context: Object.fromEntries(context) }),
  };
}

/**
 * The manifest of the registry an invocation runs in, provided at the invoke
 * tip like the templates are. It is how `kb.manifest` lists the registry it is
 * itself a member of, without an action reaching the registry.
 */
export class ActionCatalog extends Context.Service<ActionCatalog, readonly ManifestEntry[]>()(
  "kb/ActionCatalog",
) {}

/**
 * What a call made from inside the core may do: `read` refuses a call to an
 * action that writes before the core; `write` makes any call, decided by the
 * core like every call.
 */
export type InvokeScope = "read" | "write";

/**
 * One call through the invoke core, within `scope`, made while another runs:
 * it is made as that one's caller (`callWithin`).
 */
export type CoreInvoker = (
  request: ActionRequest,
  scope: InvokeScope,
) => Effect.Effect<ActionReceipt>;

/**
 * How code the core is already running reaches the invoke core. Drawing a
 * view's page is a read, so a figure that calls actions (a code view's
 * snapshot) calls them as `read`; a family's action that needs a view's
 * rendered bytes (`ext.docs.*`) asks `render.view` as `read`, the backbone
 * every surface asks; a script run once on request (`script.run`) calls as
 * `write`, each call decided as its envelope says (the `script` actor). A
 * host that provides none has no invoke core under such calls: a figure
 * draws nothing, and such an action fails.
 */
export const CoreInvoke = Context.Reference<CoreInvoker | null>("kb/CoreInvoke", {
  defaultValue: () => null,
});
