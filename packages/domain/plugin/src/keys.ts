/**
 * The two kinds of name a plugin can share with another: a service it
 * provides or injects, and a point it contributes to. A key is a name plus a type the name stands for; the type
 * lives only in the compiler (`~type` is never set). Point instances are
 * frozen host capabilities; copying their shape cannot mint a key.
 *
 * Keys are compared by identity, not by name: two keys spelled alike but
 * created apart are a conflict the kernel reports, never a silent alias. So a
 * key is created once, by the package that owns the concept, and imported by
 * everyone who uses it, or resolved through the kernel by a declared name.
 */
import type { StandardSchemaV1 } from "effect/StandardSchema";

/** A plugin family name, shared by discovery and module decoding. */
export const EXTENSION_NAME_PATTERN = /^[\w][\w.-]*$/;
/** A point local name is one identifier within its family namespace. */
export const LOCAL_POINT_NAME_PATTERN = /^[\w][\w-]*$/;

/** A declared point has exactly one local identifier within this namespace. */
export function localPointName(namespace: string, full: string): string | undefined {
  const prefix = `${namespace}.`;
  const local = full.startsWith(prefix) ? full.slice(prefix.length) : "";
  return LOCAL_POINT_NAME_PATTERN.test(local) ? local : undefined;
}

export interface Key<Kind extends string, T> {
  readonly kind: Kind;
  readonly name: string;
  readonly "~type"?: T;
}

/** An implementation one plugin provides and others inject by this key. */
export interface ServiceKey<S> extends Key<"service", S> {
  readonly spec?: ServiceSpec;
}

/**
 * A place contributions collect: actions, render templates, UI surfaces. Each
 * contribution carries an id unique within the point.
 */
export const KERNEL_HOSTS = ["registry", "server", "page"] as const;
export const POINT_CARDINALITIES = ["list", "keyed", "single", "chain"] as const;
export const POINT_TIERS = ["T0", "T1", "T2", "T3"] as const;
export type KernelHost = (typeof KERNEL_HOSTS)[number];

export interface KernelSpec {
  readonly kernel: KernelHost | readonly KernelHost[];
  readonly tier: (typeof POINT_TIERS)[number];
}

/** The canonical host set of a specification, whether it names one host or several. */
export function kernelHosts(spec: KernelSpec): readonly KernelHost[] {
  return typeof spec.kernel === "string" ? [spec.kernel] : spec.kernel;
}

export interface RolePolicy {
  readonly replaceable?: boolean;
  /** The name before a keyed cell's colon; defaults to the point name. */
  readonly rolePrefix?: string;
}

export interface ServiceSpec extends KernelSpec, RolePolicy {}

export interface PointSpec extends KernelSpec, RolePolicy {
  readonly cardinality: (typeof POINT_CARDINALITIES)[number];
  readonly combine: string;
  /** Dot-separated member path; absent means contribution id. */
  readonly keyBy?: string;
  readonly contract?: StandardSchemaV1;
}

export interface PointKey<C> extends Key<"point", C> {
  readonly spec: PointSpec;
  /** Set only on a kernel-owned declaration; the key retires with this plugin. */
  readonly declarer: string | null;
}

/** Any key, whatever it stands for — for lists such as a plugin's `inject`. */
export type AnyServiceKey = ServiceKey<unknown>;

export function Service<S>(): (name: string, spec?: ServiceSpec) => ServiceKey<S> {
  return (name, spec) =>
    Object.freeze({
      kind: "service",
      name,
      ...(spec === undefined ? {} : { spec: freezeSpec(spec) }),
    });
}

function freezeSpec<S extends KernelSpec>(spec: S): S {
  if (Array.isArray(spec.kernel)) Object.freeze(spec.kernel);
  return Object.freeze({ ...spec });
}

export function Point<C>(): (name: string, spec: PointSpec) => PointKey<C> {
  return (name, spec) => pointKey(name, spec);
}

/**
 * Read a value stored under `key` as the type `key` stands for.
 *
 * The kernel keeps services and contributions in maps of
 * `unknown`, because one map holds every key's values. What makes the read
 * sound for static keys is that writes are typed by the same key object,
 * checked by identity. Named types are the author's claim, validated by the
 * declaring contract when supplied. This module owns both type assertions.
 */
export function asKeyType<T>(_key: Key<string, T>, value: unknown): T {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the kernel's one trust: every write under this key was typed by this same key object
  return value as T;
}

/** A typed name that resolves to a kernel-owned point, never a second key. */
export type PointName<C> = Key<"point-name", C>;
export type PointReference<C> = PointKey<C> | PointName<C>;
export function PointName<C>(): (name: string) => PointName<C> {
  return (name) => ({ kind: "point-name", name });
}

/** Installed contributors restate a type; the declaring contract validates their values. */
export function asPointKey<C>(key: PointKey<unknown>): PointKey<C> {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- named point types are a contributor's promise, checked by the declaring contract when supplied
  return key as PointKey<C>;
}

const pointKeys = new WeakSet<object>();

/** The one point-key constructor; only host code and the kernel can mint keys. */
export function pointKey<C>(name: string, spec: PointSpec, declarer?: string): PointKey<C> {
  const key: PointKey<C> = Object.freeze({
    kind: "point",
    name,
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- old JavaScript keys are refused by the kernel
    spec: spec === undefined ? spec : freezeSpec(spec),
    declarer: declarer ?? null,
  });
  pointKeys.add(key);
  return key;
}
export function isPointKey(key: PointKey<unknown>): boolean {
  return pointKeys.has(key);
}

/** A service, single point, or one keyed point cell, read through its elected provider. */
export interface RoleKey<C> extends Key<"role", C> {
  readonly key: ServiceKey<C> | PointKey<C>;
  readonly cell: string | null;
}

export function roleName(
  key: ServiceKey<unknown> | PointKey<unknown>,
  cell: string | null,
): string {
  return cell === null ? key.name : `${key.spec?.rolePrefix ?? key.name}:${cell}`;
}

const nativeRoles = new Map<KernelHost, Map<string, WeakSet<object>>>();

/** undefined is an ordinary address; false is a counterfeit of a host-defined role. */
export function roleKeyAt(name: string, key: object, host: KernelHost): boolean | undefined {
  return nativeRoles.get(host)?.get(name)?.has(key);
}

/** A host defines a role reference before any provider loads; the SDK cannot mint these. */
export function Role<C>(key: ServiceKey<C> | PointKey<C>, cell?: string): RoleKey<C> {
  const name = roleName(key, cell ?? null);
  if (key.spec?.replaceable === true) {
    const hosts = kernelHosts(key.spec);
    for (const host of hosts) {
      const names = nativeRoles.get(host) ?? new Map<string, WeakSet<object>>();
      const keys = names.get(name) ?? new WeakSet<object>();
      keys.add(key);
      names.set(name, keys);
      nativeRoles.set(host, names);
    }
  }
  return Object.freeze({ kind: "role", name, key, cell: cell ?? null });
}

/** The id a contribution `id` takes in `namespace`: `<namespace>.<id>`, or `id` in the root one. */
export function namespaced(namespace: string, id: string): string {
  return namespace === "" ? id : `${namespace}.${id}`;
}

/** The top-level plugin a scoped owner belongs to; child ownership stays with its root. */
export function rootPluginName(owner: string): string {
  return owner.split("/")[0] ?? owner;
}
