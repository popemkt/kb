/**
 * The two kinds of name a plugin can share with another: a service it
 * provides or injects, and a point it contributes to. A key is a name plus a type the name stands for; the type
 * lives only in the compiler (`~type` is never set), so a key is plain data.
 *
 * Keys are compared by identity, not by name: two keys spelled alike but
 * created apart are a conflict the kernel reports, never a silent alias. So a
 * key is created once, by the package that owns the concept, and imported by
 * everyone who uses it — which is also what makes the phantom type honest.
 */
export interface Key<Kind extends string, T> {
  readonly kind: Kind;
  readonly name: string;
  readonly "~type"?: T;
}

/** An implementation one plugin provides and others inject by this key. */
export type ServiceKey<S> = Key<"service", S>;

/**
 * A place contributions collect: actions, render templates, UI surfaces. Each
 * contribution carries an id unique within the point.
 */
export const KERNEL_HOSTS = ["registry", "server", "page"] as const;
export const POINT_CARDINALITIES = ["list", "keyed", "single", "chain"] as const;
export const POINT_TIERS = ["T0", "T1", "T2", "T3"] as const;
export type KernelHost = (typeof KERNEL_HOSTS)[number];

export interface PointSpec {
  readonly cardinality: (typeof POINT_CARDINALITIES)[number];
  readonly combine: string;
  readonly kernel: KernelHost | readonly KernelHost[];
  readonly tier: (typeof POINT_TIERS)[number];
  /** Dot-separated member path; absent means contribution id. */
  readonly keyBy?: string;
}

export interface PointKey<C> extends Key<"point", C> {
  readonly spec: PointSpec;
}

/** Any key, whatever it stands for — for lists such as a plugin's `inject`. */
export type AnyServiceKey = Key<"service", unknown>;

export function Service<S>(): (name: string) => ServiceKey<S> {
  return (name) => ({ kind: "service", name });
}

export function Point<C>(): (name: string, spec: PointSpec) => PointKey<C> {
  return (name, spec) => ({ kind: "point", name, spec });
}

/**
 * Read a value stored under `key` as the type `key` stands for.
 *
 * The kernel keeps services and contributions in maps of
 * `unknown`, because one map holds every key's values. What makes the read
 * sound is that the only writes are typed by the same key object, checked by
 * identity on the way in — so this is the one place that trust is spent.
 */
export function asKeyType<T>(_key: Key<string, T>, value: unknown): T {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the kernel's one trust: every write under this key was typed by this same key object
  return value as T;
}
