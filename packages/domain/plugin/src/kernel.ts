import { Cause, Effect, Exit, Scope } from "effect";
import { PluginError, type PluginErrorReason } from "./errors.ts";
import { asKeyType, type AnyServiceKey, type Key, type PointKey, type ServiceKey } from "./keys.ts";

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
  /**
   * Labels for organising plugins (DESIGN.md → Plugin organisation). The
   * kernel reports them and never reads them. Default: none (a child: its
   * parent's).
   */
  readonly tags?: readonly string[];
  /** Runs with the plugin's scope as `Scope`: `acquireRelease` in here is released on unload. */
  readonly apply: (ctx: PluginContext) => Effect.Effect<void, PluginError, Scope.Scope>;
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
 * `pending`: loaded, waiting for an injected service. `active`: applied.
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
  /** Injected services nobody provides right now. */
  readonly missing: readonly string[];
  /** The services it provides right now, in the order it provided them. */
  readonly provides: readonly string[];
  /** Whether its apply has run to its end and it is active: what it contributed is visible. */
  readonly applied: boolean;
  readonly error: PluginError | null;
}

/**
 * One edge of the dependency graph the kernel derives (DESIGN.md → Plugin
 * organisation): `from` injects `service`, which `to` provides. Contributing
 * to a point is no dependency on whoever reads it.
 */
export interface Dependency {
  readonly from: string;
  readonly to: string;
  readonly service: string;
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
  readonly contributions: <C>(point: PointKey<C>) => readonly Contribution<C>[];
  /** The contribution holding `id` as its id or one of its aliases. */
  readonly lookup: <C>(point: PointKey<C>, id: string) => Contribution<C> | undefined;
  /**
   * Everything `owner` contributed, at every point, its children's
   * contributions included: a child loaded by a plugin is that plugin's.
   * Points in the order first contributed to, then each point's order.
   */
  readonly contributionsOf: (owner: string) => readonly PointContribution[];
  readonly service: <S>(key: ServiceKey<S>) => S | undefined;
  readonly plugins: () => readonly PluginState[];
  /**
   * Whether `plugin`, this very value, is what the kernel holds under its
   * name: how a host that converges on a list (`syncPlugins`) tells a
   * plugin it already holds from another value of the same name.
   */
  readonly holds: (plugin: Plugin) => boolean;
  /**
   * Who depends on whom, derived and never declared: an edge from each
   * plugin to the provider of each service it injects that is provided now,
   * in load order, then `inject` order. An injected service nobody provides
   * is the plugin's `missing`, not an edge.
   */
  readonly dependencies: () => readonly Dependency[];
  /** Called after every change to plugins, services or contributions. */
  readonly subscribe: (listener: () => void) => () => void;
  /** Moves on every change; the snapshot `useSyncExternalStore` compares. */
  readonly version: () => number;
}

interface Entry {
  readonly name: string;
  readonly namespace: string;
  readonly tags: readonly string[];
  readonly inject: readonly AnyServiceKey[];
  readonly parent: string | null;
  /** The value it was loaded as. */
  readonly plugin: Plugin;
  readonly apply: Plugin["apply"];
  status: PluginStatus;
  /**
   * Whether `apply` has run to its end and the plugin is still active: what
   * it contributed is visible from then until it starts to go, all at once
   * either way.
   */
  applied: boolean;
  error: PluginError | null;
  /** Open while `active`; everything the plugin registered hangs off it. */
  scope: Scope.Closeable | null;
}

interface ServiceSlot {
  readonly key: AnyServiceKey;
  readonly owner: string;
  readonly impl: unknown;
}

interface PointSlot {
  readonly key: Key<"point", unknown>;
  readonly items: Contribution<unknown>[];
  /** Ids and aliases, so a lookup and a conflict check are one read. */
  readonly byId: Map<string, Contribution<unknown>>;
}

function refusal(plugin: string, reason: PluginErrorReason, message: string): PluginError {
  return new PluginError({ plugin, reason, message });
}

function failureOf(plugin: string, cause: Cause.Cause<PluginError>): PluginError {
  const squashed = Cause.squash(cause);
  if (squashed instanceof PluginError) return squashed;
  return refusal(
    plugin,
    "apply-failed",
    squashed instanceof Error ? squashed.message : String(squashed),
  );
}

function namespaced(namespace: string, id: string): string {
  return namespace === "" ? id : `${namespace}.${id}`;
}

/** Everything a kernel knows, mutated only inside the effects below. */
interface State {
  readonly entries: Map<string, Entry>;
  readonly services: Map<string, ServiceSlot>;
  readonly points: Map<string, PointSlot>;
  readonly subscribers: Set<() => void>;
  version: number;
}

/**
 * Whether what `owner` contributed is visible: it and every plugin that
 * loaded it have applied, so a reader never sees part of a plugin's
 * contributions, while it loads or while it goes.
 */
function visible(state: State, owner: string): boolean {
  const entry = state.entries.get(owner);
  if (entry === undefined || !entry.applied) return false;
  return entry.parent === null || visible(state, entry.parent);
}

function changed(state: State): void {
  state.version++;
  for (const listener of state.subscribers) listener();
}

function missingOf(state: State, entry: Entry): string[] {
  return entry.inject
    .filter((key) => state.services.get(key.name)?.key !== key)
    .map((key) => key.name);
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

const removeService = Effect.fnUntraced(function* (state: State, name: string) {
  state.services.delete(name);
  changed(state);
  // Whoever injected it holds a reference to something that is gone: back to
  // pending, and forward again when a provider returns.
  for (const dependent of state.entries.values()) {
    if (dependent.status === "active" && dependent.inject.some((key) => key.name === name)) {
      yield* deactivate(state, dependent, "pending");
    }
  }
});

const activate = Effect.fnUntraced(function* (state: State, entry: Entry) {
  const scope = yield* Scope.make();
  entry.scope = scope;
  entry.status = "active";
  entry.error = null;
  changed(state);
  const exit = yield* Effect.exit(Scope.provide(scope)(entry.apply(contextFor(state, entry))));
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

const loadEntry = Effect.fnUntraced(function* (state: State, plugin: Plugin, parent: Entry | null) {
  const name = parent === null ? plugin.name : `${parent.name}/${plugin.name}`;
  if (state.entries.has(name)) {
    return yield* refusal(name, "name-taken", `a plugin named ${name} is loaded`);
  }
  // A child is torn down by its parent's scope, so the parent must be live
  // before the child exists at all.
  const parentScope = parent === null ? null : yield* scopeOf(parent);
  const entry: Entry = {
    name,
    namespace: plugin.namespace ?? parent?.namespace ?? plugin.name,
    tags: plugin.tags ?? parent?.tags ?? [],
    inject: plugin.inject ?? [],
    parent: parent?.name ?? null,
    plugin,
    apply: plugin.apply,
    status: "pending",
    applied: false,
    error: null,
    scope: null,
  };
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
      `service ${key.name} is already provided by ${existing.owner}`,
    );
  }
  state.services.set(key.name, { key, owner: entry.name, impl });
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
  if (slot?.key !== key) {
    return yield* refusal(entry.name, "not-loaded", `service ${key.name} is not provided`);
  }
  return slot.impl;
});

const contributeErased = Effect.fnUntraced(function* (
  state: State,
  entry: Entry,
  point: Key<"point", unknown>,
  item: ContributionEntry<unknown>,
) {
  const scope = yield* scopeOf(entry);
  const existing = state.points.get(point.name);
  yield* claim(entry.name, existing?.key, point);
  const slot: PointSlot = existing ?? { key: point, items: [], byId: new Map() };
  const contribution: Contribution<unknown> = {
    id: namespaced(entry.namespace, item.id),
    aliases: item.aliases ?? [],
    owner: entry.name,
    value: item.value,
  };
  const ids = [contribution.id, ...contribution.aliases];
  const clash = ids.find((id) => slot.byId.has(id));
  if (clash !== undefined) {
    return yield* refusal(
      entry.name,
      "contribution-conflict",
      `${point.name} already has ${clash} (from ${slot.byId.get(clash)?.owner ?? "?"})`,
    );
  }
  state.points.set(point.name, slot);
  slot.items.push(contribution);
  for (const id of ids) slot.byId.set(id, contribution);
  yield* Scope.addFinalizer(
    scope,
    Effect.sync(() => {
      slot.items.splice(slot.items.indexOf(contribution), 1);
      for (const id of ids) slot.byId.delete(id);
      changed(state);
    }),
  );
  changed(state);
  return contribution;
});

function contextFor(state: State, entry: Entry): PluginContext {
  return {
    name: entry.name,
    namespace: entry.namespace,
    get: (key) => getErased(state, entry, key).pipe(Effect.map((impl) => asKeyType(key, impl))),
    provide: (key, impl) => provideErased(state, entry, key, impl),
    contribute: (point, item) =>
      contributeErased(state, entry, point, item).pipe(
        Effect.map((contribution) => ({ ...contribution, value: item.value })),
      ),
    plugin: (child) => loadEntry(state, child, entry),
  };
}

/**
 * The plugin kernel: one per host (the server session, the CLI, the browser).
 * State is plain maps mutated only inside the kernel's own effects, and read
 * synchronously, so a UI can render from it without running an Effect.
 */
export function makeKernel(): Kernel {
  const state: State = {
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
    contributions: (point) => {
      const slot = state.points.get(point.name);
      if (slot?.key !== point) return [];
      return slot.items
        .filter((item) => visible(state, item.owner))
        .map((item) => ({ ...item, value: asKeyType(point, item.value) }));
    },
    lookup: (point, id) => {
      const slot = state.points.get(point.name);
      const item = slot?.key === point ? slot.byId.get(id) : undefined;
      return item === undefined || !visible(state, item.owner)
        ? undefined
        : { ...item, value: asKeyType(point, item.value) };
    },
    contributionsOf: (owner) =>
      [...state.points.values()].flatMap((slot) =>
        slot.items
          .filter((item) => item.owner === owner || item.owner.startsWith(`${owner}/`))
          .filter((item) => visible(state, item.owner))
          .map(({ id, aliases, owner: by }) => ({ point: slot.key.name, id, aliases, owner: by })),
      ),
    service: (key) => {
      const slot = state.services.get(key.name);
      return slot?.key === key ? asKeyType(key, slot.impl) : undefined;
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
        provides: [...state.services.values()]
          .filter((slot) => slot.owner === entry.name)
          .map((slot) => slot.key.name),
        applied: entry.applied,
        error: entry.error,
      })),
    dependencies: () =>
      [...state.entries.values()].flatMap((entry) =>
        entry.inject.flatMap((key) => {
          const slot = state.services.get(key.name);
          return slot?.key === key ? [{ from: entry.name, to: slot.owner, service: key.name }] : [];
        }),
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
