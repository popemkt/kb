/**
 * Public type surface for external `.kb/extensions/*.ts` authors: the
 * module `kb-ext-sdk`, whose values are the host's own (`EXTENSION_SDK` in
 * `@kb/contracts`), so a repository extension builds its declaration and
 * its plugin as a bundled family does.
 *
 * Self-contained but for `effect`, the plugin model's own types, so
 * `scripts/generate.ts` can emit a standalone ambient
 * `declare module "kb-ext-sdk"` that travels inside the CLI bundle. Internal
 * runtime types must stay assignable to these shapes —
 * `tests/surface-bridge.test.ts` holds them so at the type level, and the
 * CLI's `tests/ext-sdk-fresh.test.ts` compiles an author fixture against the
 * emitted module.
 *
 * Authors: `kb ext sdk --write`, then `import { definePlugin, … } from "kb-ext-sdk"`.
 */
import type * as effect from "effect";

/**
 * What invoking the action does. A `read` changes nothing. A `write` may
 * change the graph or the workspace. `approval: "required"` declares that a
 * person must approve each call, and `approval: "delegated"` that the
 * owner's own calls need no approval and anyone acting for them does.
 * `outsideRoot: true` says the action reaches past its kb root, to another
 * store or a process it starts. kb shows these on every surface and decides
 * nothing by them: a guard may (`ActionGuardPoint`), and none that ships
 * does for now.
 */
export type ActionMode =
  | { readonly kind: "read"; readonly outsideRoot?: true }
  | {
      readonly kind: "write";
      readonly approval?: "required" | "delegated";
      readonly outsideRoot?: true;
    };

export type FailureCode =
  | "not_found"
  | "invalid_input"
  | "ambiguous"
  | "conflict"
  | "invalid_move"
  | "forbidden"
  | "internal"
  | "unknown_action"
  | "approval_required";

/** Node identity: ULID, or reserved `sys.*` system ids. */
export type NodeId = string;

export type PropValue =
  | { t: "str"; v: string }
  | { t: "num"; v: number }
  | { t: "bool"; v: boolean }
  | { t: "date"; v: string }
  | { t: "ref"; v: NodeId };

export interface KbNode {
  id: NodeId;
  text: string;
  props: Record<NodeId, PropValue[]>;
  children: NodeId[];
  createdAt: string;
  updatedAt: string;
}

export interface StandardSchemaV1Issue {
  readonly message: string;
  readonly path?: ReadonlyArray<PropertyKey | { readonly key: PropertyKey }>;
}

export interface StandardSchemaV1Result<Output> {
  readonly value?: Output;
  readonly issues?: ReadonlyArray<StandardSchemaV1Issue>;
}

export interface StandardSchemaV1Like<Input = unknown, Output = Input> {
  readonly "~standard": {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (
      value: unknown,
    ) => StandardSchemaV1Result<Output> | Promise<StandardSchemaV1Result<Output>>;
    readonly types?: { readonly input: Input; readonly output: Output };
  };
}

export interface ParsableSchema {
  readonly parse: (input: unknown) => unknown;
}

/** Accept Standard Schema v1 or any object exposing `.parse` (zod). */
export type ActionSchema = StandardSchemaV1Like | ParsableSchema;

/** A failure an action names by its code (`FailureCode`): what its receipt reports. */
export interface CodedError extends Error {
  readonly code: FailureCode;
  readonly details?: unknown;
}

/**
 * Effect-native handler: its input is what `inputSchema` produced, and it
 * fails with a {@link CodedError}. It requires no service: what a bundled
 * family reads from the invoke tip's services, a repository extension
 * reaches with the owner's power directly.
 */
export type ActionEffectHandler = (input: never) => effect.Effect.Effect<unknown, CodedError>;

export interface ActionDefinition<
  TIn extends ActionSchema = ActionSchema,
  TOut extends ActionSchema = ActionSchema,
> {
  id: string;
  title: string;
  description: string;
  mode: ActionMode;
  inputSchema: TIn;
  outputSchema: TOut;
  effect?: ActionEffectHandler;
}

export type ActionReceipt =
  | {
      status: "succeeded";
      id: string;
      output: unknown;
    }
  | {
      status: "failed";
      id: string;
      code: FailureCode;
      message: string;
      details?: unknown;
    };

/**
 * Promise-handler session view. Structural subset of the live KbContext —
 * enough for authors to read `root` / `nodes` without importing core.
 */
export interface KbContext {
  root: string;
  nodes: KbNode[];
}

export type ExtensionPromiseHandler = (ctx: KbContext, input: never) => Promise<unknown>;

export type ExtensionAction = ActionDefinition & {
  /** Extra top-level ids this action also answers to (compat shims). */
  aliases?: readonly string[];
} & (
    | {
        effect: ActionEffectHandler;
        handler?: ExtensionPromiseHandler;
      }
    | {
        handler: ExtensionPromiseHandler;
        effect?: ActionEffectHandler;
      }
  );

/**
 * Render templates: named functions (query rows -> markdown) that a docs
 * view node (`sys.f.view.template`) references by id. Contributed exactly like
 * an action ({@link provideTemplate}), with the same `ext.<name>.<id>`
 * namespacing and optional bare-id `aliases`. Must be deterministic.
 */
export interface TemplateContext {
  nodes: Map<NodeId, KbNode>;
  /** Unique-text lookup among sys.field nodes; undefined if absent or ambiguous. */
  fieldIdByName(name: string): NodeId | undefined;
}

export type TemplateFn = (rows: unknown[][], ctx: TemplateContext) => string;

export interface ExtensionTemplate {
  /** Local id; the plugin's namespace makes it `ext.<name>.<id>`. */
  id: string;
  /** Extra top-level ids this template also answers to (compat shims). */
  aliases?: readonly string[];
  template: TemplateFn;
}

/** A key a plugin provides or injects a service by. Compared by identity: made once, by its owner. */
export interface ServiceKey<S> {
  readonly kind: "service";
  readonly name: string;
  readonly "~type"?: S;
}

/** A place contributions collect, each under an id unique within it. Compared by identity. */
export interface PointKey<C> {
  readonly kind: "point";
  readonly name: string;
  readonly "~type"?: C;
}

/** What a plugin hands a point: a local id, optional absolute aliases, the value. */
export interface ContributionEntry<C> {
  readonly id: string;
  readonly aliases?: readonly string[];
  readonly value: C;
}

/** A contribution as a point holds it: namespaced id, and who contributed it. */
export interface Contribution<C> {
  readonly id: string;
  readonly aliases: readonly string[];
  readonly owner: string;
  readonly value: C;
}

/** Why the kernel refused something, naming the plugin it was about. */
export type PluginErrorReason =
  | "name-taken"
  | "service-conflict"
  | "contribution-conflict"
  | "key-mismatch"
  | "not-injected"
  | "apply-failed"
  | "not-loaded";

export interface PluginError extends effect.Cause.YieldableError {
  readonly _tag: "Kb/PluginError";
  readonly plugin: string;
  readonly reason: PluginErrorReason;
}

export interface PluginHandle {
  readonly name: string;
  readonly unload: effect.Effect.Effect<void>;
}

/**
 * A plugin's handle on the kernel. Everything registered through it —
 * services, contributions, children — is undone when the plugin unloads.
 */
export interface PluginContext {
  readonly name: string;
  /** Prefix of this plugin's contribution ids; `""` is the root namespace. */
  readonly namespace: string;
  /** A service this plugin declared in `inject`. */
  get<S>(key: ServiceKey<S>): effect.Effect.Effect<S, PluginError>;
  provide<S>(key: ServiceKey<S>, impl: S): effect.Effect.Effect<void, PluginError>;
  contribute<C>(
    point: PointKey<C>,
    entry: ContributionEntry<C>,
  ): effect.Effect.Effect<Contribution<C>, PluginError>;
  /** Load a child plugin; it unloads with this one and shares its namespace by default. */
  plugin(child: Plugin): effect.Effect.Effect<PluginHandle, PluginError>;
}

/**
 * A plugin is a value: a family's server entry and its page entry are each
 * one. Its `name` is its family's (`declaration.name`).
 */
export interface Plugin {
  readonly name: string;
  /** Contribution id prefix: a family's server entry contributes in `ext.<name>` ({@link extensionNamespace}). */
  readonly namespace?: string;
  /** Services that must exist before `apply` runs; the plugin waits until they do. */
  readonly inject?: readonly ServiceKey<unknown>[];
  /** Labels for organising plugins, which kb reports and never reads: its family's ({@link familyTags}). */
  readonly tags?: readonly string[];
  /** Runs with the plugin's scope as `Scope`: `acquireRelease` in here is released on unload. */
  readonly apply: (
    ctx: PluginContext,
  ) => effect.Effect.Effect<void, PluginError, effect.Scope.Scope>;
}

/** The families of views a host chooses between by config. */
export type ViewFamily = "graph.renderer" | "outline.frame" | "gallery.workflow";

/** How a key stores its params on a view node: read from props, written back to them. */
export interface ViewConfigCodec<P> {
  read(
    props: Record<NodeId, PropValue[]>,
    host: string | null,
    report: (warning: string) => void,
  ): unknown;
  write(params: P): Record<NodeId, PropValue[]>;
}

/**
 * A view's name and the params it renders from (`<namespace>.<local id>`,
 * its family's name first). Made once with {@link viewKey} and compared by
 * identity, so the page half and the declaration import the one key.
 */
export interface ViewKey<P> {
  readonly kind: "view";
  readonly id: `${string}.${string}`;
  readonly label: string;
  readonly params: effect.Schema.Decoder<P>;
  /** The family of views a host chooses between, for a view that is one of them. */
  readonly family?: ViewFamily;
  readonly option: string;
  readonly config: ViewConfigCodec<P>;
  readonly events: readonly string[];
}

/** How a view says itself on a surface that shows text, from the settings its key read. */
export interface ViewText<P> {
  body(ctx: KbContext, params: P, host: KbNode | null): readonly string[];
  figure?(ctx: KbContext, params: P, host: KbNode | null): effect.Effect.Effect<string | null>;
}

/** One view a family provides: its key, which names its option in the seed, and its text. */
export interface ViewDef<P> {
  readonly key: ViewKey<P>;
  readonly text?: ViewText<P>;
}

/**
 * What a family declares of itself, the way a bundled family does: its
 * module's `declaration` export. The store it lives in seeds its node,
 * `sys.extension.<name>`, filed under `sys.extensions`, and every node
 * `seed` returns; a field node whose `sys.f.configures` refers to that node
 * is one of its settings. With `optional`, it can be switched, and is
 * `byDefault` in a store where no one has switched it. The views it
 * provides each get an option node under `sys.views`.
 */
export interface ExtensionDeclaration {
  /** The module's file name without `.ts`: its `ext.<name>` namespace and its node's name. */
  readonly name: string;
  readonly label: string;
  readonly optional?: { readonly byDefault: "on" | "off" };
  /** Its labels, the one home of them: each of its plugins carries them ({@link familyTags}). */
  readonly tags?: readonly string[];
  /** Its system nodes under frozen ids, stamped `at`. */
  readonly seed?: (at: string) => readonly KbNode[];
  /** The views it provides; its entries contribute exactly these (`declarationPlugin`). */
  readonly views?: readonly ViewDef<unknown>[];
  /**
   * The declared options it contributes, by kind (a design system, a
   * backdrop): each named by the id its page contribution answers to.
   */
  readonly declaredOptions?: readonly DeclaredOptionSet[];
  /**
   * The seeded ids it renamed or removed, and the labels it changed
   * (DESIGN.md → Extension families → the seed retires what it renames),
   * which opening applies before it seeds.
   */
  readonly retires?: readonly SeedRetirement[];
}

/**
 * One row of the seed's retirement table: `from` is retired; `to`, when
 * given, replaced it (`from` itself where only the label changed); `text`,
 * when given, is the label the seed wrote on `from` before.
 */
export interface SeedRetirement {
  readonly from: NodeId;
  readonly to?: NodeId;
  readonly text?: string;
}

/** One kind of declared option: the field whose children its options are, and their ids' prefix. */
export interface DeclaredOptions {
  readonly field: NodeId;
  readonly prefix: string;
}

/** The things of one kind a declaration names: the kind, and each thing's key, in order. */
export interface DeclaredOptionSet {
  readonly kind: DeclaredOptions;
  readonly options: readonly { readonly id: string; readonly label: string }[];
}

/** An action as a plugin contributes it to {@link ActionPoint}: the id is the contribution's. */
export interface ActionContribution extends Omit<ActionDefinition, "id" | "effect"> {
  readonly effect?: ActionEffectHandler;
  readonly handler?: ExtensionPromiseHandler;
}

/** The params of a view that renders from nothing but the store. */
export type NoParams = { readonly [key: string]: never };

/**
 * Who made a call, as the surface it arrived on says: the person's gesture,
 * an agent, the owner's CLI, or code in the sandbox. kb records it on the
 * transaction the call commits, and grants nothing by it.
 */
export type Actor = "human" | "agent" | "cli" | "script";

/** A call as the invoke core runs it: the action, its input, and who makes it. */
export interface ActionInvocation {
  readonly id: string;
  readonly input: unknown;
  readonly actor: Actor;
  /** A person approved it, on a surface that carries approval. */
  readonly approved?: boolean;
}

/** One node a call writes: as it was (absent when new) and as it will be (absent when deleted). */
export interface NodeWrite {
  readonly before: KbNode | undefined;
  readonly after: KbNode | undefined;
}

/** What a guard decides about a call. */
export type GuardVerdict =
  | { readonly decision: "allow" }
  | {
      readonly decision: "ask" | "deny";
      /** The rule that decided, in the guard's own terms. */
      readonly rule: string;
      readonly message: string;
      readonly details?: Readonly<Record<string, unknown>>;
    };

/** The action a call invokes, with its mode. */
export interface GuardedAction {
  readonly id: string;
  readonly mode: ActionMode;
}

/** A call as a guard is asked about it: everything it may read, nothing it may change. */
export interface GuardCall {
  readonly invocation: ActionInvocation;
  readonly action: GuardedAction;
  /** `invoke` for a call about to run; `list` when a surface lists the action, with no input. */
  readonly phase: "list" | "invoke";
  /** Aborted when the call is interrupted or the guard's budget runs out. */
  readonly signal: AbortSignal;
}

/** A call as a guard is asked about its commit: the call, and the nodes it writes. */
export interface CommitCall extends Omit<GuardCall, "phase"> {
  readonly writes: readonly NodeWrite[];
}

/** A guard: it decides about the calls it matches, and cannot change them. */
export interface ActionGuard {
  /** An action id, a pattern with `*`, or a mode word (`every read`, `every write`). */
  readonly match: string;
  readonly before?: (call: GuardCall) => effect.Effect.Effect<GuardVerdict>;
  readonly commit?: (call: CommitCall) => effect.Effect.Effect<GuardVerdict>;
}

/** A call as an interceptor sees it. */
export interface InterceptedCall {
  readonly invocation: ActionInvocation;
  readonly action: GuardedAction;
  readonly signal: AbortSignal;
}

/** An interceptor: it transforms the calls it matches, and cannot refuse them. */
export interface ActionInterceptor {
  readonly match: string;
  /** The input the call runs with, from the input it was given. */
  readonly input?: (call: InterceptedCall) => effect.Effect.Effect<unknown>;
  /** The output a succeeded call answers with, from the output it produced. */
  readonly output?: (call: InterceptedCall, output: unknown) => effect.Effect.Effect<unknown>;
}

/** The host's Effect, which a plugin's `apply` and an action's `effect` are written in. */
export declare const Effect: typeof effect.Effect;
/** The host's Schema, which a view key's params are written in. */
export declare const Schema: typeof effect.Schema;
export declare function definePlugin(plugin: Plugin): Plugin;
export declare function defineExtension(declaration: ExtensionDeclaration): ExtensionDeclaration;
/** What every host loads of a declaration: its views, contributed under their ids. */
export declare function declarationPlugin(declaration: ExtensionDeclaration): Plugin;
/** The tags a plugin of the family carries: the declaration's, then the plugin's own (`"ui"` on a page half). */
export declare function familyTags(
  declaration: ExtensionDeclaration,
  ...own: readonly string[]
): readonly string[];
/** `ext.<name>`: the namespace a family's server entry contributes in. */
export declare function extensionNamespace(name: string): string;
export declare function Point<C>(): (name: string) => PointKey<C>;
export declare function Service<S>(): (name: string) => ServiceKey<S>;
/** Every action any loaded plugin offers. */
export declare const ActionPoint: PointKey<ActionContribution>;
/** Every render template, by the id a view spec names it with. */
export declare const TemplatePoint: PointKey<TemplateFn>;
/** Every view a loaded plugin provides, by view id. */
export declare const ViewKeyPoint: PointKey<ViewDef<unknown>>;
/** Every guard: each one matching a call is asked, and the strictest verdict holds. */
export declare const ActionGuardPoint: PointKey<ActionGuard>;
/** Every interceptor: run in order on a call's input, in reverse on its output. */
export declare const ActionInterceptorPoint: PointKey<ActionInterceptor>;
/** Guard the calls `match` names, as the plugin `plugin`. */
export declare function guardAction(
  plugin: PluginContext,
  match: string,
  guard: Omit<ActionGuard, "match">,
  id?: string,
): effect.Effect.Effect<void, PluginError>;
/** Transform the calls `match` names, as the plugin `plugin`. */
export declare function onAction(
  plugin: PluginContext,
  match: string,
  hooks: Omit<ActionInterceptor, "match">,
  id?: string,
): effect.Effect.Effect<void, PluginError>;
export declare function provideAction(
  action: ExtensionAction,
): ContributionEntry<ActionContribution>;
export declare function provideTemplate(template: ExtensionTemplate): ContributionEntry<TemplateFn>;
export declare function viewKey<P>(
  id: `${string}.${string}`,
  label: string,
  params: effect.Schema.Decoder<P>,
  config?: ViewConfigCodec<P>,
  declares?: { readonly events?: readonly string[] },
): ViewKey<P>;
export declare function viewDef<P>(key: ViewKey<P>, text?: ViewText<P>): ViewDef<P>;
export declare const NoParams: effect.Schema.Decoder<NoParams>;
