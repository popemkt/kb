import { roleSession as newRoleSession, type RoleSession } from "./role-session.ts";
import { checkHost, checkPointSpec } from "./specs.ts";
import { contributeErased, contributionsAt, matchesPoint, pointValue } from "./points.ts";
import { Effect, Exit, Scope } from "effect";
import type { PluginError } from "./errors.ts";
import { authorityOf } from "./authority.ts";
import {
  elected,
  registration,
  canOccupy,
  roleCell,
  readRole,
  roleStates,
  configureRoles,
  faultRole,
  replacementApproved,
  type RoleState,
  type RoleCandidate,
  type RoleProvider,
} from "./roles.ts";
import {
  changed,
  visible,
  refusal,
  failureOf,
  pointSlot,
  scopeOf,
  assertActive,
  pluginFailure,
  alive,
  claim,
  type State,
  type Entry,
  type Activation,
  type ServiceSlot,
} from "./state.ts";
import {
  registrationCell,
  cellEntries,
  addCandidate,
  removeCandidate,
  type Registration,
} from "./cells.ts";
import {
  asKeyType,
  namespaced,
  roleKeyAt,
  asPointKey,
  pointKey,
  type RoleKey,
  type AnyServiceKey,
  type PointKey,
  type PointReference,
  type PointName,
  type PointSpec,
  type KernelHost,
  type ServiceKey,
} from "./keys.ts";

/** What a plugin hands a point: a local id, optional absolute aliases, the value. */
export interface ContributionEntry<C> {
  readonly id: string;
  /** Extra ids this contribution also answers to, taken as written (compat shims). */
  readonly aliases?: readonly string[];
  /** Full role name of the keyed cell this entry asks to replace. Not approval. */
  readonly replaces?: string;
  readonly value: C;
}

/** A contribution as a point holds it: namespaced id, and who contributed it. */
export interface Contribution<C> {
  /** `<namespace>.<id>`, or the bare id for a plugin in the root namespace. */
  readonly id: string;
  readonly aliases: readonly string[];
  /** Name of the plugin that contributed it. */
  readonly owner: string;
  readonly value: C;
}

/**
 * A contribution as one plugin's list of what it made reads it: the point it
 * was made to, by name, and the contribution with its value left out, since
 * one list spans every point and so every value type.
 */
export interface PointContribution extends Omit<Contribution<unknown>, "value"> {
  readonly point: string;
}

/**
 * A plugin's handle on the kernel. Everything registered through it —
 * services, contributions, children — belongs to the plugin's scope, so it
 * is undone when the plugin unloads or goes back to pending.
 */
export interface PluginContext {
  readonly name: string;
  /** Prefix of this plugin's contribution ids; `""` is the root namespace. */
  readonly namespace: string;
  declare<C>(name: string | PointName<C>, spec: PointSpec): Effect.Effect<PointKey<C>, PluginError>;
  point<C>(name: string | PointName<C>): Effect.Effect<PointKey<C>, PluginError>;
  contributions<C>(point: PointKey<C>): readonly Contribution<C>[];
  /** A service this plugin declared in `inject`. */
  get<S>(key: ServiceKey<S>): Effect.Effect<S, PluginError>;
  provide<S>(key: ServiceKey<S>, impl: S): Effect.Effect<void, PluginError>;
  contribute<C>(
    point: PointKey<C>,
    entry: ContributionEntry<C>,
  ): Effect.Effect<Contribution<C>, PluginError>;
  /** Load a child plugin; it unloads with this one and shares its namespace by default. */
  plugin(child: Plugin): Effect.Effect<PluginHandle, PluginError>;
}

/**
 * A plugin is a value. One that takes configuration is a function returning
 * a plugin, so composing plugins is composing values — no config channel.
 */
export interface Plugin {
  readonly name: string;
  /** Contribution id prefix. Defaults to the name (a child: its parent's namespace). */
  readonly namespace?: string;
  /** Services that must exist before `apply` runs; the plugin waits until they do. */
  readonly inject?: readonly AnyServiceKey[];
  readonly uses?: readonly string[];
  /**
   * Labels for organising plugins (DESIGN.md → Plugin organisation). The
   * kernel reports them and never reads them. Default: none (a child: its
   * parent's).
   */
  readonly tags?: readonly string[];
  /** Runs with the plugin's scope as `Scope`: `acquireRelease` in here is released on unload. */
  readonly apply: (this: void, ctx: PluginContext) => Effect.Effect<void, PluginError, Scope.Scope>;
}

export function definePlugin(plugin: Plugin): Plugin {
  return plugin;
}

/**
 * Whether `value`, code from elsewhere (a repository extension's module),
 * is a plugin as far as a runtime check can see: a name and an `apply`.
 * What `apply` does is the kernel's to find out when it loads it.
 */
export function isPlugin(value: unknown): value is Plugin {
  return (
    typeof value === "object" &&
    value !== null &&
    "name" in value &&
    typeof value.name === "string" &&
    "apply" in value &&
    typeof value.apply === "function"
  );
}

/**
 * `pending`: loaded, waiting for a service or declared point. `active`: applied.
 * `failed`: `apply` failed and everything it registered was undone.
 */
export type PluginStatus = "pending" | "active" | "failed";

export interface PluginState {
  readonly name: string;
  readonly namespace: string;
  readonly tags: readonly string[];
  readonly status: PluginStatus;
  /** The plugin that loaded this one as a child, if any. */
  readonly parent: string | null;
  /** Requirements nobody supplies right now. */
  readonly missing: readonly string[];
  readonly requirements: readonly RequirementState[];
  /** The services it provides right now, in the order it provided them. */
  readonly provides: readonly string[];
  /** Whether its apply has run to its end and it is active: what it contributed is visible. */
  readonly applied: boolean;
  readonly error: PluginError | null;
}

/**
 * One edge of the dependency graph the kernel derives (DESIGN.md → Plugin
 * organisation): a requirement names its kind and provider (or declarer).
 * Contributions depend on a point's declarer, not on its readers.
 */
export interface RequirementState {
  readonly kind: "service" | "point";
  readonly name: string;
  readonly from: string | null;
}

export interface Dependency {
  readonly from: string;
  readonly to: string;
  readonly kind: RequirementState["kind"];
  readonly name: string;
}

export interface PluginHandle {
  readonly name: string;
  /** Unload the plugin; unloading one that is already gone does nothing. */
  readonly unload: Effect.Effect<void>;
}

/**
 * Members are closures over the kernel's state, not methods: any of them can
 * be passed on unbound (`useSyncExternalStore(kernel.subscribe, kernel.version)`).
 */
export interface Kernel {
  readonly load: (plugin: Plugin) => Effect.Effect<PluginHandle, PluginError>;
  readonly unload: (name: string) => Effect.Effect<void, PluginError>;
  /** Unload every plugin, newest first. */
  readonly shutdown: Effect.Effect<void>;
  /**
   * Every contribution to a point, in the order it was made, of the plugins
   * that have applied: a plugin still applying, or already going, shows none.
   */
  readonly contributions: <C>(point: PointReference<C>) => readonly Contribution<C>[];
  /** The contribution holding `id` as its id or one of its aliases. */
  readonly lookup: <C>(point: PointReference<C>, id: string) => Contribution<C> | undefined;
  /**
   * Everything `owner` contributed, at every point, its children's
   * contributions included: a child loaded by a plugin is that plugin's.
   * Points in the order first contributed to, then each point's order.
   */
  readonly contributionsOf: (owner: string) => readonly PointContribution[];
  readonly points: () => readonly PointState[];
  readonly service: <S>(key: ServiceKey<S>) => S | undefined;
  readonly role: <C>(key: RoleKey<C>) => RoleCandidate<C> | undefined;
  readonly roles: () => readonly RoleState[];
  /** Whether this loaded family holds a host-approved claim for this exact role. */
  // GAP [[01M6YS6XH9XS4TX7S7AYWXJX3A]] the editor follow-up supplies the production inspection consumer
  readonly replacementApproved: (owner: string, role: string) => boolean;
  readonly configureRoles: (preferences: ReadonlyMap<string, string>) => Effect.Effect<void>;
  readonly fault: (
    role: string | RoleKey<unknown>,
    provider: RoleProvider,
    cause: unknown,
  ) => Effect.Effect<boolean>;
  readonly plugins: () => readonly PluginState[];
  /**
   * Whether `plugin`, this very value, is what the kernel holds under its
   * name: how a host that converges on a list (`syncPlugins`) tells a
   * plugin it already holds from another value of the same name.
   */
  readonly holds: (plugin: Plugin) => boolean;
  /**
   * Fulfilled requirements, in plugin load order, then inject and uses
   * order. A missing requirement has no edge.
   */
  readonly dependencies: () => readonly Dependency[];
  /** Called after every change to plugins, services or contributions. */
  readonly subscribe: (listener: () => void) => () => void;
  /** Moves on every change; the snapshot `useSyncExternalStore` compares. */
  readonly version: () => number;
}

export interface PointState {
  readonly key: PointKey<unknown>;
  readonly owner: string | null;
}

function serviceProvider(
  state: State,
  slot: ServiceSlot | undefined,
): Registration<unknown> | undefined {
  const candidate = slot === undefined ? undefined : elected(state, slot.cell);
  return candidate !== undefined && alive(state, candidate.owner) ? candidate : undefined;
}

function requirementsOf(state: State, entry: Entry): RequirementState[] {
  return [
    ...entry.inject.map((key): RequirementState => {
      const slot = state.services.get(key.name);
      return {
        kind: "service",
        name: key.name,
        from: slot?.key === key ? (serviceProvider(state, slot)?.owner ?? null) : null,
      };
    }),
    ...entry.uses.map(
      (name): RequirementState => ({
        kind: "point",
        name,
        from: state.points.get(name)?.key.declarer ?? null,
      }),
    ),
  ];
}

function missingOf(state: State, entry: Entry): string[] {
  return requirementsOf(state, entry)
    .filter((requirement) => requirement.from === null)
    .map((requirement) => requirement.name);
}

const deactivate = Effect.fnUntraced(function* (state: State, entry: Entry, next: PluginStatus) {
  const active = entry.activation;
  entry.status = next;
  if (active === null || active.phase === "closing") return;
  active.phase = "closing";
  changed(state);
  yield* Scope.close(active.scope, Exit.void);
  if (entry.activation === active) entry.activation = null;
  changed(state);
});

const invalidateDependents = Effect.fnUntraced(function* (state: State) {
  for (const dependent of state.entries.values()) {
    const current = requirementsOf(state, dependent);
    const moved = current.some(
      (requirement, index) => requirement.from !== dependent.activation?.bound[index]?.from,
    );
    if (dependent.status === "active" && (moved || current.some(({ from }) => from === null))) {
      yield* deactivate(state, dependent, "pending");
    }
  }
});

const activate = Effect.fnUntraced(function* (state: State, entry: Entry) {
  const scope = yield* Scope.make();
  const active: Activation = {
    entry,
    scope,
    bound: requirementsOf(state, entry),
    phase: "applying",
  };
  entry.activation = active;
  entry.status = "active";
  entry.error = null;
  changed(state);
  const apply = entry.apply;
  const exit = yield* Effect.exit(Scope.provide(scope)(apply(contextFor(state, active))));
  if (entry.activation !== active || active.phase === "closing") return;
  if (Exit.isSuccess(exit)) {
    active.phase = "active";
    changed(state);
    return;
  }
  active.phase = "closing";
  entry.status = "failed";
  entry.error = failureOf(entry.name, exit.cause);
  yield* Scope.close(scope, exit);
  if (entry.activation === active) entry.activation = null;
  changed(state);
});

/** Activate every pending plugin whose services now all exist, until none is left. */
const reconcile = Effect.fnUntraced(function* (state: State) {
  const next = (): Entry | undefined =>
    state.entries
      .values()
      .find(
        (entry) =>
          entry.status === "pending" &&
          entry.activation === null &&
          missingOf(state, entry).length === 0,
      );
  yield* invalidateDependents(state);
  for (let ready = next(); ready !== undefined; ready = next()) {
    yield* activate(state, ready);
    yield* invalidateDependents(state);
  }
});

const unloadEntry = Effect.fnUntraced(function* (state: State, target: string | Entry) {
  const name = typeof target === "string" ? target : target.name;
  const entry = state.entries.get(name);
  if (typeof target !== "string" && entry !== target) return undefined;
  if (entry === undefined) return yield* refusal(name, "not-loaded", `no plugin named ${name}`);
  yield* deactivate(state, entry, entry.status);
  if (state.entries.get(name) === entry) state.entries.delete(name);
  changed(state);
  return undefined;
});

/** Resolve one immutable load's metadata before activation starts. */
function pluginEntry(plugin: Plugin, parent: Entry | null, name: string): Entry {
  return {
    name,
    namespace: plugin.namespace ?? parent?.namespace ?? plugin.name,
    tags: plugin.tags ?? parent?.tags ?? [],
    inject: [...(plugin.inject ?? [])],
    uses: [...(plugin.uses ?? [])],
    authority: parent?.authority ??
      authorityOf(plugin) ?? {
        pointNamespace: plugin.namespace ?? plugin.name,
        source: "bundled",
        replacements: [],
        defaults: [],
      },
    parent: parent?.name ?? null,
    plugin,
    apply: plugin.apply,
    status: "pending",
    error: null,
    activation: null,
  };
}

const loadEntry = Effect.fnUntraced(function* (
  state: State,
  plugin: Plugin,
  parent: Activation | null,
) {
  const name = parent === null ? plugin.name : `${parent.entry.name}/${plugin.name}`;
  const acquire = Effect.try({
    try: () => {
      if (parent !== null) assertActive(parent);
      if (state.entries.has(name))
        throw refusal(name, "name-taken", `a plugin named ${name} is loaded`);
      const entry = pluginEntry(plugin, parent?.entry ?? null, name);
      state.entries.set(name, entry);
      const handle: PluginHandle = {
        name,
        unload: unloadEntry(state, entry).pipe(
          Effect.catchTag("Kb/PluginError", () => Effect.void),
          Effect.andThen(() => reconcile(state)),
        ),
      };
      return { entry, handle };
    },
    catch: (cause) => pluginFailure(name, cause),
  });
  const held =
    parent === null
      ? yield* acquire
      : yield* Scope.provide(parent.scope)(
          Effect.acquireRelease(acquire, ({ entry }) =>
            unloadEntry(state, entry).pipe(Effect.catchTag("Kb/PluginError", () => Effect.void)),
          ),
        );
  changed(state);
  yield* reconcile(state);
  if (held.entry.status === "failed" && held.entry.error !== null) return yield* held.entry.error;
  return held.handle;
});

const provideErased = Effect.fnUntraced(function* (
  state: State,
  active: Activation,
  key: AnyServiceKey,
  impl: unknown,
) {
  const scope = yield* scopeOf(active);
  const { entry } = active;
  if (key.spec !== undefined) yield* checkHost(entry.name, key.spec, state.host);
  yield* Scope.provide(scope)(
    Effect.acquireRelease(
      Effect.try({
        try: () => {
          assertActive(active);
          if (roleKeyAt(key.name, key, state.host) === false)
            throw refusal(entry.name, "key-mismatch", `service ${key.name} is a host-defined role`);
          const existing = state.services.get(key.name);
          claim(entry.name, existing?.key, key);
          const role = key.spec?.replaceable === true ? key.name : null;
          if (role !== null) {
            claim<"service" | "point">(entry.name, roleCell(state, role)?.key, key);
            if (roleKeyAt(role, key, state.host) !== true)
              throw refusal(entry.name, "invalid-point", `role ${role} needs its host definition`);
          }
          const candidate = registration(state, entry, role, impl, "service-conflict");
          canOccupy(existing?.cell, candidate, "service-conflict");
          const slot = existing ?? { key, cell: registrationCell(candidate, role) };
          if (existing !== undefined) addCandidate(slot.cell, candidate);
          state.services.set(key.name, slot);
          return { slot, candidate };
        },
        catch: (cause) => pluginFailure(entry.name, cause),
      }),
      ({ slot, candidate }) =>
        Effect.gen(function* () {
          removeCandidate(slot.cell, candidate);
          if (slot.cell.entries.length === 0 && state.services.get(key.name) === slot)
            state.services.delete(key.name);
          changed(state);
          yield* invalidateDependents(state);
        }),
    ),
  );
  changed(state);
});

const getErased = Effect.fnUntraced(function* (
  state: State,
  active: Activation,
  key: AnyServiceKey,
) {
  return yield* Effect.try({
    try: () => {
      const entry = assertActive(active);
      if (!entry.inject.includes(key))
        throw refusal(
          entry.name,
          "not-injected",
          `${entry.name} reads ${key.name} without declaring it in inject`,
        );
      const slot = state.services.get(key.name);
      const provider = serviceProvider(state, slot);
      if (slot?.key !== key || provider === undefined)
        throw refusal(entry.name, "not-loaded", `service ${key.name} is not provided`);
      return provider.value;
    },
    catch: (cause) => pluginFailure(active.entry.name, cause),
  });
});

const namedPoint = Effect.fnUntraced(function* <C>(
  state: State,
  active: Activation,
  reference: string | PointName<C>,
) {
  return yield* Effect.try({
    try: () => {
      const entry = assertActive(active);
      const name = typeof reference === "string" ? reference : reference.name;
      const slot = state.points.get(name);
      if (!entry.uses.includes(name) && slot?.key.declarer !== entry.name)
        throw refusal(entry.name, "not-used", `${name} must be listed in uses`);
      if (slot === undefined || slot.key.declarer === null)
        throw refusal(entry.name, "not-loaded", `point ${name} is not declared`);
      return asPointKey<C>(slot.key);
    },
    catch: (cause) => pluginFailure(active.entry.name, cause),
  });
});

const declarePoint = Effect.fnUntraced(function* <C>(
  state: State,
  active: Activation,
  reference: string | PointName<C>,
  spec: PointSpec,
) {
  const scope = yield* scopeOf(active);
  const { entry } = active;
  const prefix = `${entry.authority.pointNamespace}.`;
  const full =
    typeof reference === "string"
      ? namespaced(entry.authority.pointNamespace, reference)
      : reference.name;
  const local = full.startsWith(prefix) ? full.slice(prefix.length) : "";
  if (local.length === 0 || local.includes(".") || entry.authority.pointNamespace === "")
    return yield* refusal(
      entry.name,
      "invalid-point",
      "declare requires one local name without dots in the family's namespace",
    );
  if (spec.replaceable === true && entry.authority.source !== "bundled")
    return yield* refusal(
      entry.name,
      "invalid-point",
      "replaceable points require a bundled host role definition",
    );
  const key = pointKey<C>(full, spec, entry.name);
  yield* checkPointSpec(entry.name, key.spec, state.host);
  yield* Scope.provide(scope)(
    Effect.acquireRelease(
      Effect.try({
        try: () => {
          assertActive(active);
          if (state.points.has(full))
            throw refusal(entry.name, "point-conflict", `point ${full} is already registered`);
          state.points.set(full, pointSlot(key));
        },
        catch: (cause) => pluginFailure(entry.name, cause),
      }),
      () =>
        Effect.gen(function* () {
          if (state.points.get(full)?.key === key) state.points.delete(full);
          changed(state);
          yield* invalidateDependents(state);
        }),
    ),
  );
  changed(state);
  return key;
});

function contextFor(state: State, active: Activation): PluginContext {
  const { entry } = active;
  return {
    name: entry.name,
    namespace: entry.namespace,
    declare: (name, spec) => declarePoint(state, active, name, spec),
    point: (name) => namedPoint(state, active, name),
    contributions: (point) =>
      entry.activation === active && active.phase !== "closing"
        ? contributionsAt(state, point)
        : [],
    get: (key) => getErased(state, active, key).pipe(Effect.map((impl) => asKeyType(key, impl))),
    provide: (key, impl) => provideErased(state, active, key, impl),
    contribute: (point, item) =>
      contributeErased(state, active, point, item).pipe(
        Effect.map((contribution) => ({
          ...contribution,
          value: asKeyType(point, contribution.value),
        })),
      ),
    plugin: (child) => loadEntry(state, child, active),
  };
}

/**
 * The plugin kernel: one per host (the server session, the CLI, the browser).
 * State is plain maps mutated only inside the kernel's own effects, and read
 * synchronously, so a UI can render from it without running an Effect.
 */
export function makeKernel({
  host,
  roleSession,
}: {
  readonly host: KernelHost;
  readonly roleSession?: RoleSession;
}): Kernel {
  const state: State = {
    host,
    entries: new Map(),
    services: new Map(),
    points: new Map(),
    subscribers: new Set(),
    roleSelections: new Map(),
    roleSession: roleSession ?? newRoleSession(),
    version: 0,
  };
  return {
    load: (plugin) => loadEntry(state, plugin, null),
    unload: (name) => unloadEntry(state, name).pipe(Effect.andThen(() => reconcile(state))),
    shutdown: Effect.suspend(() =>
      Effect.forEach(
        [...state.entries.values()].filter((entry) => entry.parent === null).toReversed(),
        (entry) =>
          unloadEntry(state, entry.name).pipe(Effect.catchTag("Kb/PluginError", () => Effect.void)),
        { discard: true },
      ),
    ),
    contributions: (point) => contributionsAt(state, point),
    lookup: (point, id) => {
      const slot = state.points.get(point.name);
      const cell = matchesPoint(slot, point) ? slot?.byId.get(id) : undefined;
      const candidate = cell === undefined ? undefined : elected(state, cell);
      if (cell === undefined || candidate === undefined || !visible(state, candidate.owner))
        return undefined;
      const item = pointValue(cell, candidate);
      return { ...item, value: asKeyType(point, item.value) };
    },
    contributionsOf: (owner) =>
      [...state.points.values()].flatMap((slot) =>
        cellEntries(slot.cells)
          .filter((item) => item.owner === owner || item.owner.startsWith(`${owner}/`))
          .filter((item) => visible(state, item.owner))
          .map(({ value, owner: by }) => ({
            point: slot.key.name,
            id: value.id,
            aliases: value.aliases,
            owner: by,
          })),
      ),
    points: () =>
      [...state.points.values()]
        .filter((slot) =>
          slot.key.declarer !== null
            ? visible(state, slot.key.declarer)
            : cellEntries(slot.cells).some((item) => visible(state, item.owner)),
        )
        .map(({ key }) => ({ key, owner: key.declarer ?? null })),
    service: (key) => {
      const slot = state.services.get(key.name);
      const provider = serviceProvider(state, slot);
      return slot?.key === key && provider !== undefined
        ? asKeyType(key, provider.value)
        : undefined;
    },
    role: (role) => readRole(state, role),
    roles: () => roleStates(state),
    replacementApproved: (owner, role) => replacementApproved(state, owner, role),
    configureRoles: (preferences) =>
      Effect.gen(function* () {
        configureRoles(state, preferences);
        yield* reconcile(state);
      }),
    fault: (role, provider, cause) =>
      Effect.gen(function* () {
        const faulted = faultRole(
          state,
          typeof role === "string" ? role : role.name,
          provider,
          cause,
        );
        if (faulted) yield* reconcile(state);
        return faulted;
      }),
    holds: (plugin) => state.entries.get(plugin.name)?.plugin === plugin,
    plugins: () =>
      [...state.entries.values()].map((entry) => ({
        name: entry.name,
        namespace: entry.namespace,
        tags: entry.tags,
        status: entry.status,
        parent: entry.parent,
        missing: missingOf(state, entry),
        requirements: requirementsOf(state, entry),
        provides: [...state.services.values()]
          .filter((slot) => slot.cell.entries.some((provider) => provider.owner === entry.name))
          .map((slot) => slot.key.name),
        applied: entry.activation?.phase === "active",
        error: entry.error,
      })),
    dependencies: () =>
      [...state.entries.values()].flatMap((entry) =>
        requirementsOf(state, entry).flatMap(({ kind, name, from }) =>
          from === null ? [] : [{ from: entry.name, to: from, kind, name }],
        ),
      ),
    subscribe: (listener) => {
      state.subscribers.add(listener);
      return () => {
        state.subscribers.delete(listener);
      };
    },
    version: () => state.version,
  };
}
