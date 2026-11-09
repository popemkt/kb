import { Cause, Effect, type Scope } from "effect";
import { PluginError, type PluginErrorReason } from "./errors.ts";
import type { AnyServiceKey, PointKey, KernelHost, Key } from "./keys.ts";
import type { Cell } from "./cells.ts";
import type { Contribution, Plugin, PluginStatus, RequirementState } from "./kernel.ts";
import type { RoleSession } from "./role-session.ts";
import type { PluginAuthority } from "./authority.ts";

export interface Entry {
  readonly name: string;
  readonly namespace: string;
  readonly tags: readonly string[];
  readonly inject: readonly AnyServiceKey[];
  readonly uses: readonly string[];
  readonly authority: PluginAuthority;
  readonly parent: string | null;
  /** The value it was loaded as. */
  readonly plugin: Plugin;
  readonly apply: Plugin["apply"];
  status: PluginStatus;
  error: PluginError | null;
  activation: Activation | null;
}

export interface Activation {
  readonly entry: Entry;
  readonly scope: Scope.Closeable;
  readonly bound: readonly RequirementState[];
  phase: "applying" | "active" | "closing";
}

export interface ServiceSlot {
  readonly key: AnyServiceKey;
  readonly cell: Cell<unknown>;
}

export type PointValue = Omit<Contribution<unknown>, "owner">;

export interface PointSlot {
  readonly key: PointKey<unknown>;
  readonly cells: Cell<PointValue>[];
  /** Ids and aliases, so a lookup and a conflict check are one read. */
  readonly byId: Map<string, Cell<PointValue>>;
}

export function pointSlot(key: PointKey<unknown>): PointSlot {
  return { key, cells: [], byId: new Map() };
}

export function refusal(plugin: string, reason: PluginErrorReason, message: string): PluginError {
  return new PluginError({ plugin, reason, message });
}

export function pluginFailure(plugin: string, cause: unknown): PluginError {
  if (cause instanceof PluginError) return cause;
  return refusal(plugin, "apply-failed", cause instanceof Error ? cause.message : String(cause));
}

export function failureOf(plugin: string, cause: Cause.Cause<PluginError>): PluginError {
  return pluginFailure(plugin, Cause.squash(cause));
}

/** Everything a kernel knows, mutated only inside the effects below. */
export interface State {
  readonly host: KernelHost;
  readonly entries: Map<string, Entry>;
  readonly services: Map<string, ServiceSlot>;
  readonly points: Map<string, PointSlot>;
  readonly subscribers: Set<() => void>;
  roleSelections: Map<string, string>;
  readonly roleSession: RoleSession;
  version: number;
}

/**
 * Whether what `owner` contributed is visible: it and every plugin that
 * loaded it have applied, so a reader never sees part of a plugin's
 * contributions, while it loads or while it goes.
 */
export function visible(state: State, owner: string): boolean {
  const entry = state.entries.get(owner);
  if (entry?.activation?.phase !== "active") return false;
  return entry.parent === null || visible(state, entry.parent);
}

export function changed(state: State): void {
  state.version++;
  for (const listener of state.subscribers) listener();
}

/** A context belongs to one activation, including across service-driven reapplication. */
export function assertActive(active: Activation): Entry {
  if (active.entry.activation !== active || active.phase === "closing")
    throw refusal(active.entry.name, "not-loaded", `plugin ${active.entry.name} is not active`);
  return active.entry;
}

export function scopeOf(active: Activation): Effect.Effect<Scope.Closeable, PluginError> {
  return Effect.try({
    try: () => {
      assertActive(active);
      return active.scope;
    },
    catch: (cause) => pluginFailure(active.entry.name, cause),
  });
}

export function claim<K extends string>(
  owner: string,
  slotKey: Key<K, unknown> | undefined,
  key: Key<K, unknown>,
): void {
  if (slotKey !== undefined && slotKey !== key)
    throw refusal(owner, "key-mismatch", `two different ${key.kind} keys are named ${key.name}`);
}

export function alive(state: State, owner: string): boolean {
  const entry = state.entries.get(owner);
  if (
    entry?.activation === null ||
    entry?.activation === undefined ||
    entry.activation.phase === "closing"
  )
    return false;
  return entry.parent === null || alive(state, entry.parent);
}
