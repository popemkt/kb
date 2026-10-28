import { Effect } from "effect";
import type { FileSystem } from "effect/FileSystem";
import {
  ActionPoint,
  ContextReferencePoint,
  CurrentContextReferences,
  CurrentInterception,
  contextReferencesOf,
  contextRefusal,
  FamilyKernels,
  TemplatePoint,
  ViewKeyPoint,
  declarationPlugin,
  actionToManifestEntry,
  extensionPagePath,
  extensionRow,
  familyOn,
  NO_SWITCHES,
  type NodeLookup,
  type ActionContribution,
  type ActionHandlerEnv,
  type ActionInvocation,
  type ActionReceipt,
  type ContextReferences,
  type ExtensionFailure,
  type ExtensionRow,
  type FamilyKernel,
  type Interception,
  type KbContext,
  type LoadedExtension,
  type ManifestEntry,
  type TemplateFn,
  type ViewDef,
  familyTags,
} from "@kb/contracts";
import type { ActionSchemaError, DomainError } from "@kb/model";
import {
  coreActions,
  coreExtension,
  interceptionFrom,
  invokeReceiptWith,
  invokeWith,
  type RegisteredAction,
} from "@kb/operations";
import { viewCatalogOf, type ViewCatalogOf } from "@kb/views";
import { definePlugin, makeKernel, type Contribution, type Kernel, type Plugin } from "@kb/plugin";
import { GOVERNANCE_FAMILY, governanceMode } from "./deployment.ts";
import { resetRootFamilies, rootFamilies, vouchedFamilies } from "./families.ts";
import { writeErr } from "./output.ts";

/** Services Effect-native handlers may require; provided at the invoke tip. */
export type { ActionHandlerEnv } from "@kb/contracts";

/** A render template as registered: namespaced id plus its compat aliases. */
export interface RegisteredTemplate {
  /** Namespaced `ext.<name>.<id>`. */
  id: string;
  template: TemplateFn;
  /** "ext:<name>" */
  source: string;
  aliases: readonly string[];
}

interface RegistryExtension {
  name: string;
  /** "bundled" or the source module path. */
  source: string;
  /** Registered actions; defs carry the namespaced `ext.<name>.<id>`. */
  actions: readonly RegisteredAction[];
  /** Registered templates; ids carry the namespaced `ext.<name>.<id>`. */
  templates: readonly RegisteredTemplate[];
}

export interface Registry extends ActionTable {
  /** The kernel every action and template was loaded into. */
  kernel: Kernel;
  /** The action contributions its table was made from, each keeping every rule an action keeps. */
  contributions: readonly Contribution<ActionContribution>[];
  /** The guards and interceptors its plugins contribute, which every call through it goes through. */
  interception: Interception;
  /** The context references its plugins contribute, which fill a call made in a tab session. */
  references: ContextReferences;
  /** When its kernel is released: once it is replaced, and the calls that hold it have settled. */
  lifetime: RegistryLifetime;
  /** Render templates by namespaced id and by alias; fed to the TemplateRegistry service. */
  templates: ReadonlyMap<string, TemplateFn>;
  extensions: readonly RegistryExtension[];
  failures: readonly ExtensionFailure[];
  /** The views the loaded plugins contributed to `ViewKeyPoint`: what the `ViewCatalog` service holds. */
  views: ViewCatalogOf<ViewDef<unknown>>;
  /**
   * Every bundled family, loaded or not, then each repository extension that
   * loaded: what `kb.manifest` reports of this registry (`ExtensionCatalog`).
   */
  families: readonly ExtensionRow[];
}

/**
 * A registry's lifetime. A call that runs plugin code holds the registry it
 * runs on (`withSessionRegistry`); the registry that replaces it for its
 * root retires it, and its kernel is shut down, every plugin's scope
 * closed, once it is retired and no call holds it. Releasing is done once.
 */
interface RegistryLifetime {
  /** Hold the registry for a call; false once it is released, when the call takes its root's current one. */
  readonly acquire: () => boolean;
  /** A call that held the registry has settled. */
  readonly settle: Effect.Effect<void>;
  /** The registry is replaced for its root: released once no call holds it. */
  readonly retire: Effect.Effect<void>;
}

function registryLifetime(kernel: Kernel): RegistryLifetime {
  let holds = 0;
  let retired = false;
  let released = false;
  const releaseIfIdle = Effect.suspend(() => {
    if (!retired || holds > 0 || released) return Effect.void;
    released = true;
    return kernel.shutdown;
  });
  return {
    acquire: () => {
      if (released) return false;
      holds += 1;
      return true;
    },
    settle: Effect.suspend(() => {
      holds -= 1;
      return releaseIfIdle;
    }),
    retire: Effect.suspend(() => {
      retired = true;
      return releaseIfIdle;
    }),
  };
}

/**
 * Core's server entry: its actions, contributed like anyone else's but in the
 * root namespace, and its declaration's views, loaded as a child.
 */
const corePlugin = definePlugin({
  name: coreExtension.name,
  tags: familyTags(coreExtension),
  namespace: "",
  apply: (ctx) =>
    Effect.all(
      [
        Effect.forEach(
          coreActions,
          (action) =>
            ctx.contribute(ActionPoint, {
              id: action.def.id,
              aliases: action.aliases,
              value: { ...action.def, effect: action.effect, handler: action.handler },
            }),
          { discard: true },
        ),
        ctx.plugin(declarationPlugin(coreExtension)),
      ],
      { discard: true },
    ),
});

/** The context references a kernel's plugins contribute, core's first. */
function referencesOf(kernel: Pick<Kernel, "contributions">): ContextReferences {
  return contextReferencesOf(() => kernel.contributions(ContextReferencePoint));
}

/** The top-level plugin a contribution belongs to (a child answers for its parent). */
function rootOwner(contribution: Contribution<unknown>): string {
  return contribution.owner.split("/")[0] ?? contribution.owner;
}

function sourceOf(contribution: Contribution<unknown>): string {
  const owner = rootOwner(contribution);
  return owner === corePlugin.name ? "core" : `ext:${owner}`;
}

function registeredAction(contribution: Contribution<ActionContribution>): RegisteredAction {
  const { value } = contribution;
  return {
    def: {
      id: contribution.id,
      title: value.title,
      description: value.description,
      mode: value.mode,
      ...(value.batchOf === undefined ? {} : { batchOf: value.batchOf }),
      ...(value.targets === undefined ? {} : { targets: value.targets }),
      ...(value.context === undefined ? {} : { context: value.context }),
      inputSchema: value.inputSchema,
      outputSchema: value.outputSchema,
    },
    effect: value.effect,
    handler: value.handler,
    source: sourceOf(contribution),
    aliases: contribution.aliases,
  };
}

function registeredTemplate(contribution: Contribution<TemplateFn>): RegisteredTemplate {
  return {
    id: contribution.id,
    template: contribution.value,
    source: sourceOf(contribution),
    aliases: contribution.aliases,
  };
}

/** What a call reaches by id: each action under its id and its aliases, and their listing. */
interface ActionTable {
  readonly actions: readonly RegisteredAction[];
  readonly byId: ReadonlyMap<string, RegisteredAction>;
  readonly manifestEntries: readonly ManifestEntry[];
}

/** The table `contributions` make, their context references read from `references`. */
function actionTable(
  contributions: readonly Contribution<ActionContribution>[],
  references: ContextReferences,
): ActionTable {
  const actions = contributions.map(registeredAction);
  const byId = new Map<string, RegisteredAction>();
  for (const action of actions) {
    byId.set(action.def.id, action);
    for (const alias of action.aliases) byId.set(alias, action);
  }
  const modeOf = (id: string) => byId.get(id)?.def.mode;
  const manifestEntries: ManifestEntry[] = actions.flatMap((action) => [
    actionToManifestEntry(action.def, modeOf, references),
    ...action.aliases.map((alias) => ({
      ...actionToManifestEntry(action.def, modeOf, references),
      id: alias,
      aliasOf: action.def.id,
    })),
  ]);
  return { actions, byId, manifestEntries };
}

/**
 * The rules every registered action keeps, as the error the first one that
 * breaks them is refused with:
 *
 * - **A batch's parts.** Each is a registered action that is not itself a
 *   batch. A batch is decided as itself and as each part by the part's own
 *   mode, one level deep, so a part must be there to read and must not need
 *   deciding as parts of its own.
 * - **What a session fills.** Each key its `context` names is one its input
 *   requires, read from a reference a loaded plugin contributes
 *   (`contextRefusal`).
 */
function brokenAction(
  contributions: readonly Contribution<ActionContribution>[],
  references: ContextReferences,
): { readonly contribution: Contribution<ActionContribution>; readonly error: string } | null {
  const batches = new Set(
    contributions.flatMap((c) => (c.value.batchOf === undefined ? [] : [c.id, ...c.aliases])),
  );
  const registered = new Set(contributions.flatMap((c) => [c.id, ...c.aliases]));
  for (const contribution of contributions) {
    const bad = (contribution.value.batchOf ?? []).filter(
      (part) => !registered.has(part) || batches.has(part),
    );
    if (bad.length > 0) {
      const why = bad
        .map(
          (part) => `${part} ${registered.has(part) ? "is itself a batch" : "is not registered"}`,
        )
        .join("; ");
      return {
        contribution,
        error: `action ${contribution.id} is a batch of an action that cannot be one of its parts: ${why}`,
      };
    }
    const refused = contextRefusal({ ...contribution.value, id: contribution.id }, references);
    if (refused !== null) return { contribution, error: refused };
  }
  return null;
}

/** A hosted action left out of what a call reaches: the reason, said once per registry. */
function leftOut(contribution: Contribution<ActionContribution>, error: string): void {
  writeErr(`kb: hosted action ${contribution.id}: ${error} (left out)`);
}

/**
 * The hosted contributions every rule an action keeps admits beside the
 * registry's: an id or alias the registry holds is the registry's, and one
 * that breaks a batch's or a context's rule (`brokenAction`) is left out,
 * as a registry family's is unloaded. Each one left out is said.
 */
function admitted(
  registry: Registry,
  hosted: readonly Contribution<ActionContribution>[],
): readonly Contribution<ActionContribution>[] {
  let admit = hosted.filter((contribution) => {
    const held = [contribution.id, ...contribution.aliases].find((id) => registry.byId.has(id));
    if (held !== undefined) leftOut(contribution, `${held} is the registry's`);
    return held === undefined;
  });
  for (;;) {
    const broken = brokenAction([...registry.contributions, ...admit], registry.references);
    // The registry's own already keep every rule, so what breaks one is hosted.
    if (broken === null || !admit.includes(broken.contribution)) return admit;
    leftOut(broken.contribution, broken.error);
    const out = broken.contribution;
    admit = admit.filter((contribution) => contribution !== out);
  }
}

/** The table each registry reaches with the hosted actions it was last read with. */
const reached = new WeakMap<
  Registry,
  { readonly hosted: readonly ActionContribution[]; readonly table: ActionTable }
>();

/**
 * The actions a call on this host reaches: the registry's, then those of
 * each kernel the host composes families in beside it (`kernels`, the
 * host's `FamilyKernels`: the `kb ui` server's hosted agent), listed and
 * invoked like any other (DESIGN.md → Plugin channels → hosted actions).
 * A host that composes nothing reaches the registry's alone. The table is
 * made again only when what the host kernels contribute changes.
 */
export function reachableActions(
  registry: Registry,
  kernels: readonly FamilyKernel[],
): ActionTable {
  const hosted = kernels.flatMap(({ source, kernel }) =>
    source === "host" ? kernel.contributions(ActionPoint) : [],
  );
  if (hosted.length === 0) return registry;
  const values = hosted.map(({ value }) => value);
  const known = reached.get(registry);
  if (
    known !== undefined &&
    known.hosted.length === values.length &&
    known.hosted.every((value, at) => value === values[at])
  ) {
    return known.table;
  }
  const table = actionTable(
    [...registry.contributions, ...admitted(registry, hosted)],
    registry.references,
  );
  reached.set(registry, { hosted: values, table });
  return table;
}

/**
 * A plugin whose action breaks a rule every action keeps (`brokenAction`)
 * is a plugin that cannot load: it is unloaded as a unit and reported in
 * `failures`, the list a failed load reaches (`kb ext list`, and stderr).
 * Unloading it can take away another batch's part, or a reference another
 * action fills from, so the check runs until every action left holds. Core
 * breaking one is a programming error, and dies.
 */
export const unloadBrokenActions = Effect.fnUntraced(function* (
  kernel: Kernel,
  loaded: {
    readonly core: string;
    readonly sources: Map<string, string>;
    readonly failures: ExtensionFailure[];
  },
): Effect.fn.Return<void> {
  for (;;) {
    const first = brokenAction(kernel.contributions(ActionPoint), referencesOf(kernel));
    if (first === null) return undefined;
    const { error } = first;
    const owner = rootOwner(first.contribution);
    if (owner === loaded.core) return yield* Effect.die(new Error(`core: ${error}`));
    const inside = (name: string) => name === owner || name.startsWith(`${owner}/`);
    const nested = kernel.plugins().filter((p) => p.name !== owner && inside(p.name));
    yield* kernel.unload(owner).pipe(Effect.orDie);
    // The fixpoint ends only because each pass takes a plugin away for good.
    const left =
      kernel.plugins().some((p) => inside(p.name)) || kernel.contributionsOf(owner).length > 0;
    if (left) return yield* Effect.die(new Error(`plugin ${owner} is still loaded after unload`));
    const file = loaded.sources.get(owner) ?? owner;
    loaded.failures.push({ file, error });
    for (const child of nested) {
      loaded.failures.push({ file, error: `${child.name} unloaded with ${owner}: ${error}` });
    }
    loaded.sources.delete(owner);
  }
});

/**
 * The registry is a reading of the kernel: load core and each of the root's
 * families (`rootFamilies`) the store has on (`on`), then derive every table
 * from the points they contributed to. A plugin that cannot load (a clash,
 * a throwing module) is reported, as is a module discovery refused
 * (`refused`), and leaves nothing behind.
 */
const buildRegistry = Effect.fnUntraced(function* (
  families: readonly LoadedExtension[],
  on: readonly LoadedExtension[],
  refused: readonly ExtensionFailure[],
  required: readonly string[],
): Effect.fn.Return<Registry> {
  const kernel = makeKernel();
  const failures: ExtensionFailure[] = [...refused];
  const sources = new Map<string, string>();

  const load = (plugin: Plugin, source: string): Effect.Effect<void> =>
    kernel.load(plugin).pipe(
      Effect.map(() => {
        sources.set(plugin.name, source);
      }),
      Effect.catchTag("Kb/PluginError", (error) =>
        Effect.sync(() => {
          failures.push({ file: source, error: error.message });
        }),
      ),
    );

  yield* load(corePlugin, "core");
  for (const { entry, source } of on) yield* load(entry, source);

  yield* unloadBrokenActions(kernel, { core: corePlugin.name, sources, failures });

  const references = referencesOf(kernel);
  const contributions = kernel.contributions(ActionPoint);
  const { actions, byId, manifestEntries } = actionTable(contributions, references);
  const templateEntries = kernel.contributions(TemplatePoint).map(registeredTemplate);
  const templates = new Map<string, TemplateFn>();
  for (const template of templateEntries) {
    templates.set(template.id, template.template);
    for (const alias of template.aliases) templates.set(alias, template.template);
  }

  const extensions: RegistryExtension[] = [...sources]
    .filter(([name]) => name !== corePlugin.name)
    .map(([name, source]) => ({
      name,
      source,
      actions: actions.filter((action) => action.source === `ext:${name}`),
      templates: templateEntries.filter((template) => template.source === `ext:${name}`),
    }));

  const views = viewCatalogOf(kernel.contributions(ViewKeyPoint).map(({ value }) => value));

  const rows: ExtensionRow[] = families.map(({ declaration, source, digest, page }) =>
    extensionRow(
      declaration,
      source,
      sources.get(declaration.name) === source,
      page === undefined || digest === undefined ? undefined : extensionPagePath(digest),
      digest,
    ),
  );

  return {
    kernel,
    contributions,
    interception: interceptionFrom(kernel, { required }),
    references,
    lifetime: registryLifetime(kernel),
    actions,
    byId,
    templates,
    extensions,
    failures,
    manifestEntries,
    views,
    families: rows,
  };
});

/** Each root's current registry, by the key it was composed for. */
const current = new Map<
  string,
  { readonly key: string; readonly registry: Effect.Effect<Registry, never, FileSystem> }
>();
const NO_ROOT_KEY = "no-root";

/**
 * Registry for a kb root: core actions + each of its families
 * (`rootFamilies`: the bundled ones, then `.kb/extensions/*.ts`) its store
 * has on. An optional family is on while the store `nodeOf` reads says so,
 * or by its declared default where it says nothing (`familyOn`); with no
 * store, every optional family is as it is by default. A root has one
 * registry at a time, kept while the families on, each with its closure's
 * digest, are the same; switching a family, or trusting or untrusting one,
 * composes a new one, and the one it replaces is retired, so the plugins of
 * a family switched off or untrusted are unloaded, their scopes closed,
 * once the calls running on it have settled. `null` root = core + bundled
 * only.
 */
export const registryFor = Effect.fn("kb.registryFor")(function* (
  root: string | null,
  nodeOf: NodeLookup = NO_SWITCHES,
): Effect.fn.Return<Registry, never, FileSystem> {
  const { families, failures } = yield* rootFamilies(root);
  const unread: string[] = [];
  const on = families.filter(({ declaration }) =>
    familyOn(declaration, nodeOf, (warning) => unread.push(`${declaration.name}: ${warning}`)),
  );
  const rootKey = root ?? NO_ROOT_KEY;
  const key = on
    .map(({ declaration, digest }) => `${declaration.name}@${digest ?? "bundled"}`)
    .join("\0");
  const held = current.get(rootKey);
  if (held?.key === key) return yield* held.registry;
  // `Effect.cached` is what makes the entry a build-once value rather than a
  // recipe: concurrent callers share the one in-flight build.
  // The deployment, not the store, decides whether governance is composed (`deploys`).
  const built = yield* Effect.cached(
    buildRegistry(families, on, failures, requiredFamilies()).pipe(
      Effect.tap((registry) =>
        Effect.sync(() => {
          for (const failure of registry.failures) {
            writeErr(`kb: extension ${failure.file}: ${failure.error} (skipped)`);
          }
        }),
      ),
    ),
  );
  // Another caller may have composed this key while the build was set up.
  const replaced = current.get(rootKey);
  if (replaced?.key === key) return yield* replaced.registry;
  for (const warning of unread) writeErr(`kb: extension switch ${warning} (read as its default)`);
  current.set(rootKey, { key, registry: built });
  if (replaced !== undefined) yield* (yield* replaced.registry).lifetime.retire;
  return yield* built;
});

/**
 * Admission: every failure `root`'s families meet when each of its
 * repository extensions is vouched for and every family is on, composed
 * as `registryFor` composes them (`vouchedFamilies`, then the kernel load
 * with its clash and handler checks), so an extension a gate admits is one
 * the runtime loads. Empty when all of them load; it prints nothing, the
 * caller reports. The registry it builds is retired before it answers, so
 * nothing it loaded stays.
 */
// GAP [[01M5ZC6V2ZAVDG9972PADX58S0]] Admission bundles a page half but imports and
// decodes only the server half; a page half that bundles yet fails in the page
// still passes the gate (DESIGN.md → Core boundary & extensions).
export const admitExtensions = Effect.fn("kb.admitExtensions")(function* (
  root: string,
): Effect.fn.Return<readonly ExtensionFailure[], never, FileSystem> {
  return yield* Effect.acquireUseRelease(
    refuseExit,
    () =>
      Effect.gen(function* () {
        const { families, failures } = yield* vouchedFamilies(root);
        const registry = yield* buildRegistry(families, families, failures, requiredFamilies());
        yield* registry.lifetime.retire;
        return registry.failures;
      }),
    (held) =>
      Effect.sync(() => {
        process.exit = held.exit;
        process.reallyExit = held.reallyExit;
      }),
  );
});

/**
 * While admission runs code nobody trusted, `process.exit` and
 * `process.reallyExit` (`PROCESS_EXITS`) throw instead of ending the
 * process, so a module that calls either at import fails its own load
 * rather than ending the gate with the exit code it chose. Answers the
 * calls it replaced.
 */
const refuseExit = Effect.sync(() => {
  const held = { exit: process.exit.bind(process), reallyExit: process.reallyExit.bind(process) };
  for (const name of PROCESS_EXITS) {
    process[name] = (code?: number | string | null) => {
      throw new Error(`called process.${name}(${String(code ?? "")}) while it was admitted`);
    };
  }
  return held;
});

/**
 * The calls that end the process at once, each refused while admission
 * runs (`refuseExit`): `exit`, and Bun's `reallyExit`, which `exit` itself
 * ends in and which a module can call past it.
 */
const PROCESS_EXITS = ["exit", "reallyExit"] as const;

/** The families a registry refuses to run without: governance, where the deployment requires it (`deploys`). */
function requiredFamilies(): readonly string[] {
  return governanceMode() === "required" ? [GOVERNANCE_FAMILY] : [];
}

/** The registry a session runs in: its root's, as its own store switches the families. */
export function sessionRegistry(ctx: KbContext): Effect.Effect<Registry, never, FileSystem> {
  return registryFor(ctx.root, (id) => ctx.index.getNode(id));
}

/**
 * Run `use` on the session's registry, holding it until `use` settles, so a
 * registry replaced meanwhile is released only after: what a call that runs
 * plugin code goes through. One already released is never used; the call
 * takes its root's current registry instead.
 */
const withSessionRegistry = <A, E, R>(
  ctx: KbContext,
  use: (registry: Registry) => Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R | FileSystem> =>
  Effect.gen(function* () {
    const registry = yield* sessionRegistry(ctx);
    if (!registry.lifetime.acquire()) return yield* withSessionRegistry(ctx, use);
    return yield* use(registry).pipe(
      Effect.provideService(CurrentInterception, registry.interception),
      Effect.provideService(CurrentContextReferences, registry.references),
      Effect.ensuring(registry.lifetime.settle),
    );
  });

/** Test hook: forget cached registries so fresh roots re-discover extensions. */
export function resetRegistryCache(): void {
  current.clear();
  resetRootFamilies();
}

export const manifest = Effect.fn("kb.manifest")(function* (
  root?: string,
): Effect.fn.Return<readonly ManifestEntry[], never, FileSystem> {
  return (yield* registryFor(root ?? null)).manifestEntries;
});

/**
 * The actions a call reaches through `registry` on this host: its own, and
 * the hosted ones of the host's `FamilyKernels` (`reachableActions`).
 */
const reachedBy = Effect.fnUntraced(function* (registry: Registry) {
  return reachableActions(registry, yield* FamilyKernels).byId;
});

/**
 * Invoke over the discovered registry. The invoke core lives in
 * `@kb/operations` (`invokeWith`); this binds it to the session's registry
 * and what its host composes beside it.
 */
export const invokeEffect = Effect.fn("kb.invoke")(function* (
  ctx: KbContext,
  invocation: ActionInvocation,
): Effect.fn.Return<ActionReceipt, ActionSchemaError | DomainError, ActionHandlerEnv> {
  return yield* withSessionRegistry(ctx, (registry) =>
    Effect.flatMap(reachedBy(registry), (byId) => invokeWith(byId, ctx, invocation)),
  );
});

export const invokeReceiptEffect = Effect.fn("kb.invokeReceipt")(function* (
  ctx: KbContext,
  invocation: ActionInvocation,
): Effect.fn.Return<ActionReceipt, never, ActionHandlerEnv> {
  return yield* withSessionRegistry(ctx, (registry) =>
    Effect.flatMap(reachedBy(registry), (byId) => invokeReceiptWith(byId, ctx, invocation)),
  );
});

export { receiptFromError, isEffectNativeAction } from "@kb/operations";
