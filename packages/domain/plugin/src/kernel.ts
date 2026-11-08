import { Effect, Exit, Scope, Predicate } from "effect";
import type { PluginError } from "./errors.ts";
import {
  changed,
  visible,
  refusal,
  failureOf,
  pointSlot,
  serviceProvider,
  type State,
  type Entry,
  type PointSlot,
} from "./state.ts";
import { cell, cellEntries } from "./cells.ts";
import {
  asKeyType,
  asPointKey,
  pointKey,
  isPointKey,
  type AnyServiceKey,
  type Key,
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

const pointNamespaces = new WeakMap<Plugin, string>();

/** Host admission binds declaration authority without changing contribution ids. */
export function bindPointNamespace(plugin: Plugin, namespace: string): Plugin {
  const bound = { ...plugin };
  pointNamespaces.set(bound, namespace);
  return bound;
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

/** The id a contribution `id` takes in `namespace`: `<namespace>.<id>`, or `id` in the root one. */
export function namespaced(namespace: string, id: string): string {
  return namespace === "" ? id : `${namespace}.${id}`;
}

function requirementsOf(state: State, entry: Entry): RequirementState[] {
  return [
    ...entry.inject.map((key): RequirementState => {
      const slot = state.services.get(key.name);
      return {
        kind: "service",
        name: key.name,
        from: slot?.key === key ? (serviceProvider(slot)?.owner ?? null) : null,
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

function scopeOf(entry: Entry): Effect.Effect<Scope.Closeable, PluginError> {
  return entry.scope === null
    ? Effect.fail(refusal(entry.name, "not-loaded", `plugin ${entry.name} is not active`))
    : Effect.succeed(entry.scope);
}

/** The slot's key must be this very key object: one name, one meaning. */
function claim<K extends string>(
  owner: string,
  slotKey: Key<K, unknown> | undefined,
  key: Key<K, unknown>,
): Effect.Effect<void, PluginError> {
  return slotKey === undefined || slotKey === key
    ? Effect.void
    : Effect.fail(
        refusal(owner, "key-mismatch", `two different ${key.kind} keys are named ${key.name}`),
      );
}

const deactivate = Effect.fnUntraced(function* (state: State, entry: Entry, next: PluginStatus) {
  const scope = entry.scope;
  // Marked inactive, and the kernel moved, before its finalizers run: a
  // finalizer that reaches back into the kernel, and a reader that keeps
  // what it read until the kernel moves, both see a plugin already on its
  // way out, and no reader sees half of what it contributed. It moves again
  // once the finalizers have taken back what the plugin registered.
  entry.scope = null;
  entry.applied = false;
  entry.status = next;
  changed(state);
  if (scope !== null) yield* Scope.close(scope, Exit.void);
  changed(state);
});

const invalidateDependents = Effect.fnUntraced(function* (state: State) {
  for (const dependent of state.entries.values()) {
    if (dependent.status === "active" && missingOf(state, dependent).length > 0) {
      yield* deactivate(state, dependent, "pending");
    }
  }
});

const removeService = Effect.fnUntraced(function* (state: State, name: string) {
  state.services.delete(name);
  changed(state);
  // Whoever injected it holds a reference to something that is gone: back to
  // pending, and forward again when a provider returns.
  yield* invalidateDependents(state);
});

const activate = Effect.fnUntraced(function* (state: State, entry: Entry) {
  const scope = yield* Scope.make();
  entry.scope = scope;
  entry.status = "active";
  entry.error = null;
  changed(state);
  const apply = entry.apply;
  const exit = yield* Effect.exit(Scope.provide(scope)(apply(contextFor(state, entry))));
  if (entry.scope !== scope) return;
  if (Exit.isSuccess(exit)) {
    entry.applied = true;
    changed(state);
    return;
  }
  // A failed apply leaves nothing behind: closing its scope undoes every
  // registration it made before it failed.
  entry.scope = null;
  entry.status = "failed";
  entry.error = failureOf(entry.name, exit.cause);
  yield* Scope.close(scope, exit);
  changed(state);
});

/** Activate every pending plugin whose services now all exist, until none is left. */
const reconcile = Effect.fnUntraced(function* (state: State) {
  const next = (): Entry | undefined =>
    state.entries
      .values()
      .find((entry) => entry.status === "pending" && missingOf(state, entry).length === 0);
  for (let ready = next(); ready !== undefined; ready = next()) yield* activate(state, ready);
});

const unloadEntry = Effect.fnUntraced(function* (state: State, name: string) {
  const entry = state.entries.get(name);
  if (entry === undefined) {
    return yield* refusal(name, "not-loaded", `no plugin named ${name}`);
  }
  yield* deactivate(state, entry, entry.status);
  state.entries.delete(name);
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
    pointNamespace:
      parent?.pointNamespace ?? pointNamespaces.get(plugin) ?? plugin.namespace ?? plugin.name,
    parent: parent?.name ?? null,
    plugin,
    apply: plugin.apply,
    status: "pending",
    applied: false,
    error: null,
    scope: null,
  };
}

const loadEntry = Effect.fnUntraced(function* (state: State, plugin: Plugin, parent: Entry | null) {
  const name = parent === null ? plugin.name : `${parent.name}/${plugin.name}`;
  if (state.entries.has(name)) {
    return yield* refusal(name, "name-taken", `a plugin named ${name} is loaded`);
  }
  // A child is torn down by its parent's scope, so the parent must be live
  // before the child exists at all.
  const parentScope = parent === null ? null : yield* scopeOf(parent);
  const entry = pluginEntry(plugin, parent, name);
  state.entries.set(name, entry);
  changed(state);
  const handle: PluginHandle = {
    name,
    unload: unloadEntry(state, name).pipe(Effect.catchTag("Kb/PluginError", () => Effect.void)),
  };
  if (parentScope !== null) yield* Scope.addFinalizer(parentScope, handle.unload);
  yield* reconcile(state);
  if (entry.status === "failed" && entry.error !== null) return yield* entry.error;
  return handle;
});

const provideErased = Effect.fnUntraced(function* (
  state: State,
  entry: Entry,
  key: AnyServiceKey,
  impl: unknown,
) {
  const scope = yield* scopeOf(entry);
  const existing = state.services.get(key.name);
  yield* claim(entry.name, existing?.key, key);
  if (existing !== undefined) {
    return yield* refusal(
      entry.name,
      "service-conflict",
      `service ${key.name} is already provided by ${serviceProvider(existing)?.owner ?? "?"}`,
    );
  }
  state.services.set(key.name, { key, cell: cell({ owner: entry.name, impl }) });
  yield* Scope.addFinalizer(scope, removeService(state, key.name));
  changed(state);
  // A new service can be the last thing a pending plugin was waiting for; it
  // activates once this plugin's load is done with the kernel.
  return undefined;
});

const getErased = Effect.fnUntraced(function* (state: State, entry: Entry, key: AnyServiceKey) {
  if (!entry.inject.includes(key)) {
    return yield* refusal(
      entry.name,
      "not-injected",
      `${entry.name} reads ${key.name} without declaring it in inject`,
    );
  }
  const slot = state.services.get(key.name);
  const provider = serviceProvider(slot);
  if (slot?.key !== key || provider === undefined) {
    return yield* refusal(entry.name, "not-loaded", `service ${key.name} is not provided`);
  }
  return provider.impl;
});

const checkPointHost = Effect.fnUntraced(function* (
  owner: string,
  spec: PointSpec,
  host: KernelHost,
) {
  const hosts = typeof spec.kernel === "string" ? [spec.kernel] : spec.kernel;
  if (!hosts.includes(host)) {
    return yield* refusal(
      owner,
      "wrong-kernel",
      `point requires ${hosts.join(" or ")}; this kernel is ${host}`,
    );
  }
  return undefined;
});

const contributionValue = Effect.fnUntraced(function* (
  owner: string,
  host: KernelHost,
  point: PointKey<unknown>,
  input: unknown,
) {
  if (!isPointKey(point))
    return yield* refusal(
      owner,
      "invalid-point",
      "point keys must come from the host or ctx.declare",
    );
  // oxlint-disable-next-line typescript/no-unnecessary-condition -- installed JavaScript may use a pre-PointSpec SDK
  if (point.spec === undefined) {
    return yield* refusal(owner, "invalid-point", `${point.name} requires a PointSpec`);
  }
  yield* checkPointHost(owner, point.spec, host);
  return point.spec.contract === undefined
    ? input
    : yield* decodeContribution(owner, point.spec.contract, input);
});

function memberAt(value: unknown, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>(
      (current, key) => (Predicate.isObject(current) ? current[key] : undefined),
      value,
    );
}

const checkPointCell = Effect.fnUntraced(function* (
  owner: string,
  point: PointKey<unknown>,
  slot: PointSlot,
  contribution: Contribution<unknown>,
) {
  if (point.spec.cardinality === "single" && slot.cells.length > 0) {
    return yield* refusal(
      owner,
      "contribution-conflict",
      `${point.name} accepts only one contribution`,
    );
  }
  const key =
    point.spec.cardinality === "single"
      ? null
      : point.spec.cardinality === "keyed" && point.spec.keyBy !== undefined
        ? memberAt(contribution.value, point.spec.keyBy)
        : contribution.id;
  const keyBy = point.spec.keyBy;
  if (point.spec.cardinality === "keyed" && keyBy !== undefined) {
    if (
      key === undefined ||
      cellEntries(slot.cells).some((held) => Object.is(memberAt(held.value, keyBy), key))
    ) {
      return yield* refusal(
        owner,
        "contribution-conflict",
        `${point.name} requires a unique ${point.spec.keyBy}`,
      );
    }
  }
  return undefined;
});

const contributeErased = Effect.fnUntraced(function* (
  state: State,
  entry: Entry,
  point: PointKey<unknown>,
  item: ContributionEntry<unknown>,
) {
  const scope = yield* scopeOf(entry);
  const value = yield* contributionValue(entry.name, state.host, point, item.value);
  if (entry.scope !== scope)
    return yield* refusal(
      entry.name,
      "not-loaded",
      "plugin activation changed while validating its contribution",
    );
  const existing = state.points.get(point.name);
  if (point.declarer !== null) {
    if (existing?.key !== point)
      return yield* refusal(entry.name, "not-loaded", `point ${point.name} is retired`);
    if (point.declarer !== entry.name && !entry.uses.includes(point.name))
      return yield* refusal(entry.name, "not-used", `${point.name} must be listed in uses`);
  }
  yield* claim(entry.name, existing?.key, point);
  const slot: PointSlot = existing ?? pointSlot(point);
  const contribution: Contribution<unknown> = {
    id: namespaced(entry.namespace, item.id),
    aliases: item.aliases ?? [],
    owner: entry.name,
    value,
  };
  const ids = [contribution.id, ...contribution.aliases];
  const clash = ids.find((id) => slot.byId.has(id));
  if (clash !== undefined) {
    return yield* refusal(
      entry.name,
      "contribution-conflict",
      `${point.name} already has ${clash} (from ${slot.byId.get(clash)?.entries[0]?.owner ?? "?"})`,
    );
  }
  yield* checkPointCell(entry.name, point, slot, contribution);
  const held = cell(contribution);
  state.points.set(point.name, slot);
  slot.cells.push(held);
  for (const id of ids) slot.byId.set(id, held);
  yield* Scope.addFinalizer(
    scope,
    Effect.sync(() => {
      slot.cells.splice(slot.cells.indexOf(held), 1);
      for (const id of ids) slot.byId.delete(id);
      changed(state);
    }),
  );
  changed(state);
  return contribution;
});

function matchesPoint<C>(slot: PointSlot | undefined, point: PointReference<C>): boolean {
  return (
    slot !== undefined &&
    (point.kind === "point-name" ? slot.key.declarer !== null : slot.key === point)
  );
}
function contributionsAt<C>(state: State, point: PointReference<C>): readonly Contribution<C>[] {
  const slot = state.points.get(point.name);
  if (!matchesPoint(slot, point) || slot === undefined) return [];
  return cellEntries(slot.cells)
    .filter((item) => visible(state, item.owner))
    .map((item) => ({ ...item, value: asKeyType(point, item.value) }));
}

const decodeContribution = Effect.fn("plugin.decodeContribution")(function* (
  owner: string,
  contract: NonNullable<PointSpec["contract"]>,
  value: unknown,
) {
  const invalid = (cause: unknown) => refusal(owner, "invalid-contribution", String(cause));
  const decode = yield* Effect.try({
    try: () => {
      const checked = contract["~standard"].validate(value);
      return Predicate.isPromise(checked)
        ? Effect.tryPromise({ try: () => checked, catch: invalid })
        : Effect.succeed(checked);
    },
    catch: invalid,
  });
  const result = yield* decode;
  if (result.issues !== undefined)
    return yield* invalid(result.issues.map((issue) => issue.message).join("; "));
  return result.value;
});

const namedPoint = Effect.fn("plugin.point")(function* <C>(
  state: State,
  entry: Entry,
  reference: string | PointName<C>,
) {
  const name = typeof reference === "string" ? reference : reference.name;
  const slot = state.points.get(name);
  if (!entry.uses.includes(name) && slot?.key.declarer !== entry.name) {
    return yield* refusal(entry.name, "not-used", `${name} must be listed in uses`);
  }
  if (slot === undefined || slot.key.declarer === null)
    return yield* refusal(entry.name, "not-loaded", `point ${name} is not declared`);
  return asPointKey<C>(slot.key);
});

const declarePoint = Effect.fn("plugin.declare")(function* <C>(
  state: State,
  entry: Entry,
  reference: string | PointName<C>,
  spec: PointSpec,
) {
  const scope = yield* scopeOf(entry);
  const prefix = `${entry.pointNamespace}.`;
  const full =
    typeof reference === "string" ? namespaced(entry.pointNamespace, reference) : reference.name;
  const local = full.startsWith(prefix) ? full.slice(prefix.length) : "";
  if (local.length === 0 || local.includes(".") || entry.pointNamespace === "") {
    return yield* refusal(
      entry.name,
      "invalid-point",
      "declare requires one local name without dots in the family's namespace",
    );
  }
  yield* checkPointHost(entry.name, spec, state.host);
  if (state.points.has(full))
    return yield* refusal(entry.name, "point-conflict", `point ${full} is already registered`);
  const key = pointKey<C>(full, spec, entry.name);
  state.points.set(full, pointSlot(key));
  yield* Scope.addFinalizer(
    scope,
    Effect.gen(function* () {
      state.points.delete(full);
      changed(state);
      yield* invalidateDependents(state);
    }),
  );
  changed(state);
  return key;
});

function contextFor(state: State, entry: Entry): PluginContext {
  return {
    name: entry.name,
    namespace: entry.namespace,
    declare: (name, spec) => declarePoint(state, entry, name, spec),
    point: (name) => namedPoint(state, entry, name),
    contributions: (point) => contributionsAt(state, point),
    get: (key) => getErased(state, entry, key).pipe(Effect.map((impl) => asKeyType(key, impl))),
    provide: (key, impl) => provideErased(state, entry, key, impl),
    contribute: (point, item) =>
      contributeErased(state, entry, point, item).pipe(
        Effect.map((contribution) => ({
          ...contribution,
          value: asKeyType(point, contribution.value),
        })),
      ),
    plugin: (child) => loadEntry(state, child, entry),
  };
}

/**
 * The plugin kernel: one per host (the server session, the CLI, the browser).
 * State is plain maps mutated only inside the kernel's own effects, and read
 * synchronously, so a UI can render from it without running an Effect.
 */
export function makeKernel({ host }: { readonly host: KernelHost }): Kernel {
  const state: State = {
    host,
    entries: new Map(),
    services: new Map(),
    points: new Map(),
    subscribers: new Set(),
    version: 0,
  };
  return {
    load: (plugin) => loadEntry(state, plugin, null),
    unload: (name) => unloadEntry(state, name),
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
      const item = matchesPoint(slot, point) ? slot?.byId.get(id)?.entries[0] : undefined;
      return item === undefined || !visible(state, item.owner)
        ? undefined
        : { ...item, value: asKeyType(point, item.value) };
    },
    contributionsOf: (owner) =>
      [...state.points.values()].flatMap((slot) =>
        cellEntries(slot.cells)
          .filter((item) => item.owner === owner || item.owner.startsWith(`${owner}/`))
          .filter((item) => visible(state, item.owner))
          .map(({ id, aliases, owner: by }) => ({ point: slot.key.name, id, aliases, owner: by })),
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
      const provider = serviceProvider(slot);
      return slot?.key === key && provider !== undefined
        ? asKeyType(key, provider.impl)
        : undefined;
    },
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
        applied: entry.applied,
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
