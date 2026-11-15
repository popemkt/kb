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
  order?: string;
  createdAt: string;
  updatedAt: string;
}

export type StandardSchemaV1Issue = effect.StandardSchema.StandardSchemaV1.Issue;
export type StandardSchemaV1Result<Output> = effect.StandardSchema.StandardSchemaV1.Result<Output>;
export type StandardSchemaV1Like<
  Input = unknown,
  Output = Input,
> = effect.StandardSchema.StandardSchemaV1<Input, Output>;

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
  readonly spec?: ServiceSpec;
}

export type KernelHost = "registry" | "server" | "page";

export interface KernelSpec {
  readonly kernel: KernelHost | readonly KernelHost[];
  readonly tier: "T0" | "T1" | "T2" | "T3";
}

export interface RolePolicy {
  readonly replaceable?: boolean;
  readonly rolePrefix?: string;
}

export interface ServiceSpec extends KernelSpec, RolePolicy {}

export interface PointSpec extends KernelSpec, RolePolicy {
  readonly cardinality: "list" | "keyed" | "single" | "chain";
  readonly combine: string;
  readonly keyBy?: string;
  readonly contract?: effect.StandardSchema.StandardSchemaV1;
}

/** A place contributions collect, with its contract and unique contribution ids. */
export interface PointKey<C> {
  readonly kind: "point";
  readonly name: string;
  readonly "~type"?: C;
  readonly spec: PointSpec;
  readonly declarer: string | null;
}

/** A typed reference resolves to a kernel-owned point by name. */
export interface PointName<C> {
  readonly kind: "point-name";
  readonly name: string;
  readonly "~type"?: C;
}

/** What a plugin hands a point: a local id, optional absolute aliases, the value. */
export interface ContributionEntry<C> {
  readonly id: string;
  readonly aliases?: readonly string[];
  readonly replaces?: string;
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
  | "wrong-kernel"
  | "invalid-point"
  | "point-conflict"
  | "not-used"
  | "invalid-contribution"
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
  declare<C>(
    name: string | PointName<C>,
    spec: PointSpec,
  ): effect.Effect.Effect<PointKey<C>, PluginError>;
  point<C>(name: string | PointName<C>): effect.Effect.Effect<PointKey<C>, PluginError>;
  contributions<C>(point: PointKey<C>): readonly Contribution<C>[];
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
  readonly uses?: readonly string[];
  /** Labels for organising plugins, which kb reports and never reads: its family's ({@link familyTags}). */
  readonly tags?: readonly string[];
  /** Runs with the plugin's scope as `Scope`: `acquireRelease` in here is released on unload. */
  readonly apply: (
    this: void,
    ctx: PluginContext,
  ) => effect.Effect.Effect<void, PluginError, effect.Scope.Scope>;
}

/** The families of views a host chooses between by config. */
/** A stable view-family key supplied by its declaration, rather than a closed core list. */
export type ViewFamily = string;

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
  /**
   * What preview the view draws of a node it opens, under the node's row in
   * the outline: `still`, a picture that pressing opens; `live`, the view's
   * controls acting in place; null, none.
   */
  readonly preview: "still" | "live" | null;
}

/**
 * A key no host chooses between by config: the kind {@link viewKey} makes,
 * and the kind a page half contributes a view for (`kb-ext-sdk/page`'s
 * `provideView`).
 */
export type PlainViewKey<P> = ViewKey<P> & { readonly family?: undefined };

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
 * is one of its settings. It can always be switched off; `optional` says
 * whether it starts `on` (as when it says nothing) or `off` in a store
 * where no one has switched it. The views it provides each get an option
 * node under `sys.views`.
 */
export interface ExtensionDeclaration {
  readonly colorTokens?: Readonly<Record<`--${string}`, string>>;
  /** The module's file name without `.ts`: its `ext.<name>` namespace and its node's name. */
  readonly name: string;
  readonly label: string;
  // What it says about itself (its one line, author, capabilities) is its `<name>.manifest.json`'s,
  // beside this module: kb reads it before anyone trusts the code (docs/extensions/README.md).
  readonly optional?: { readonly byDefault: "on" | "off" };
  /** Its labels, the one home of them: each of its plugins carries them ({@link familyTags}). */
  readonly tags?: readonly string[];
  /** Its system nodes under frozen ids, stamped `at`. */
  readonly seed?: (at: string) => readonly KbNode[];
  /** The views it provides; its entries contribute exactly these (`declarationPlugin`). */
  /**
   * Its own seed nodes it files under a list node, by the list's id: a pin
   * among the Pinned, a view among the Views, or a node only it reads (a
   * query its commands ask) under its own node, `sys.extension.<name>`, so
   * the outline's home does not show it.
   */
  readonly files?: Readonly<Record<NodeId, readonly NodeId[]>>;
  readonly views?: readonly ViewDef<unknown>[];
  /**
   * The tags whose nodes open in one of its own `views` before the store's
   * default: by the tag's id, the view's key. A tag another declaration
   * already claims makes this one not fold, so it is refused as a unit.
   */
  readonly tagDefaultViews?: Readonly<Record<NodeId, ViewKey<unknown>>>;
  /**
   * The tags whose nodes an outline draws as one of its own `views`, in
   * place of their row's text while no one edits it: by the tag's id, the
   * view's key, which its page half provides at placement `row`. A tag
   * another declaration already claims makes this one not fold.
   */
  readonly tagRowViews?: Readonly<Record<NodeId, ViewKey<unknown>>>;
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

/** A declared thing of `kind`, by its declared id. */
export interface DeclaredRef {
  readonly kind: DeclaredOptions;
  readonly id: string;
}

/**
 * A declared thing as its declaration names it: its id, `<name>.<local id>`
 * in its family's namespace (discovery refuses one outside it), the id its
 * page contribution answers to, and the label its option node carries.
 */
export interface SeedOption {
  readonly id: string;
  readonly label: string;
  /** Lower first across contributors; equal priorities retain declaration order. Defaults to zero. */
  readonly order?: number;
  /** Declared things of other kinds its option node chooses. */
  readonly chooses?: readonly DeclaredRef[];
  /** Settings its option node holds as its own. */
  readonly props?: Record<NodeId, PropValue[]>;
  /** Its live parameters, each with its default: a backdrop's, or a backdrop variant's own. */
  readonly knobs?: readonly Knob[];
}

/** The things of one kind a declaration names: the kind, and each thing's key, in order. */
export interface DeclaredOptionSet {
  readonly kind: DeclaredOptions;
  readonly options: readonly SeedOption[];
}

/** One choice of an enum knob: its id, the value the knob takes, and its label. */
export interface KnobOption {
  readonly id: string;
  readonly label: string;
}

/**
 * A knob: one typed, live parameter of a scene, as whatever draws it
 * declares it. Its value is a field on the node of what declares it, which
 * the seed derives, so the studio, `kb set` and an agent all set it. A
 * schema must be well formed (each id once, each default one its own knob
 * accepts, at most one seed), or discovery refuses the module.
 */
export type Knob =
  | {
      readonly kind: "number";
      readonly id: string;
      readonly label: string;
      readonly min: number;
      readonly max: number;
      readonly step: number;
      readonly default: number;
      readonly unit?: string;
    }
  | {
      readonly kind: "boolean";
      readonly id: string;
      readonly label: string;
      readonly default: boolean;
    }
  | {
      readonly kind: "enum";
      readonly id: string;
      readonly label: string;
      readonly options: readonly KnobOption[];
      readonly default: string;
    }
  /** A colour, `#rrggbb`. */
  | {
      readonly kind: "color";
      readonly id: string;
      readonly label: string;
      readonly default: string;
    }
  /** The seed a scene's variation is drawn from: a whole number pins one; null draws one each load. */
  | {
      readonly kind: "seed";
      readonly id: string;
      readonly label: string;
      readonly default: number | null;
    };

export type KnobValue = Knob["default"];
export type KnobValues = Readonly<Record<string, KnobValue>>;

export type ColorScheme = "dark" | "light";
export type BackdropStrength = "subtle" | "soft" | "vivid";
export type BackdropDirection = "down" | "up";

/** One of a backdrop's variants: a composition of it, by a local id. */
export interface BackdropVariant {
  readonly id: string;
  readonly label: string;
  /** The schemes it is made for; both unless it says. */
  readonly schemes?: readonly ColorScheme[];
  /** The strength it is shown at where no setting chooses one; its backdrop's unless it says. */
  readonly strength?: BackdropStrength;
  readonly knobs?: readonly Knob[];
}

/**
 * A backdrop as a declaration names it: a declared option of the backdrop
 * kind ({@link BACKDROP_OPTIONS}), whose work it is drawn after (`credit`),
 * the strength it is shown at where no setting chooses one, its knobs and
 * its variants. Its page half contributes it under the same key
 * (`kb-ext-sdk/page`'s `provideBackdrop`).
 */
export interface SeedBackdrop extends SeedOption {
  readonly credit?: string;
  readonly strength?: BackdropStrength;
  readonly variants?: readonly BackdropVariant[];
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
export type Actor =
  | "human"
  | "agent"
  | "cli"
  | "script"
  | { readonly kind: "reaction"; readonly id: string };

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

/** A node as a guard reads it: what it says, its fields' values and its children. */
export interface NodeLike {
  readonly id: NodeId;
  readonly text: string;
  readonly props: Readonly<Record<NodeId, readonly PropValue[]>>;
  readonly children: readonly NodeId[];
}

/** A call as a guard is asked about its commit: the call, and the nodes it writes. */
export interface CommitCall extends Omit<GuardCall, "phase"> {
  readonly writes: readonly NodeWrite[];
  /** How the writes' fields, kinds and named nodes are read: the graph before the commit. */
  readonly nodeOf: (id: NodeId) => NodeLike | undefined;
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

/** A store transaction, as recorded by the committing process. */
export interface StoreTx {
  upserts: KbNode[];
  deletes: NodeId[];
}
export interface KbTx {
  rev: number;
  ops: StoreTx;
  at: string;
  origin?: string;
  actor?: Actor;
  session?: string;
  via?: string;
}
export interface TxMatch {
  readonly tagged?: readonly NodeId[];
  readonly untagged?: readonly NodeId[];
  readonly fields?: readonly NodeId[];
  readonly created?: boolean;
  readonly deleted?: boolean;
}
/** Frozen commit data; writes are only the nodes matched by this listener. */
export interface TxChange {
  readonly tx: Readonly<Omit<KbTx, "ops">>;
  readonly writes: readonly NodeWrite[];
}
export interface ReactionHost {
  readonly signal: AbortSignal;
  readonly invoke: (
    id: string,
    input: Readonly<Record<string, unknown>>,
  ) => effect.Effect.Effect<ActionReceipt>;
}
export interface TxReaction {
  readonly match: TxMatch;
  readonly react: (change: TxChange, kb: ReactionHost) => effect.Effect.Effect<void>;
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
export declare function Service<S>(): (name: string, spec?: ServiceSpec) => ServiceKey<S>;
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
/** Matching local commits, delivered after the outer invocation settles; no page-kernel reactions. */
export declare const TxAfterPoint: PointKey<TxReaction>;
export declare function onCommit(
  plugin: PluginContext,
  match: TxMatch,
  react: TxReaction["react"],
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
  declares?: { readonly events?: readonly string[]; readonly preview?: "still" | "live" },
): PlainViewKey<P>;
export declare function viewDef<P>(key: ViewKey<P>, text?: ViewText<P>): ViewDef<P>;
export declare const NoParams: effect.Schema.Decoder<NoParams>;
/**
 * The field types' kind: a declaration lists the types it adds under it,
 * each choosing the built-in type it stores as (`sys.ft.number`'s option,
 * `{ kind: FIELD_TYPE_OPTIONS, id: "number" }`). Its page half contributes
 * the type's value kind (`kb-ext-sdk/page`'s `provideValueKind`), and a
 * guard of its server entry holds its values to their form.
 */
export declare const FIELD_TYPE_OPTIONS: DeclaredOptions;
/** The backdrops' kind: what a declaration lists its backdrops' keys under. */
export declare const BACKDROP_OPTIONS: DeclaredOptions;
/** The backdrops' variants' kind (`backdropVariantOptions` names them). */
export declare const BACKDROP_VARIANT_OPTIONS: DeclaredOptions;
/** The variants of `backdrops` as options of {@link BACKDROP_VARIANT_OPTIONS}, each choosing its backdrop. */
export declare function backdropVariantOptions(backdrops: readonly SeedBackdrop[]): SeedOption[];
