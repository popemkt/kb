import { Cause, type Scope } from "effect";
import { PluginError, type PluginErrorReason } from "./errors.ts";
import type { AnyServiceKey, PointKey, KernelHost } from "./keys.ts";
import type { Cell } from "./cells.ts";
import type { Contribution, Plugin, PluginStatus } from "./kernel.ts";

export interface Entry {
  readonly name: string;
  readonly namespace: string;
  readonly tags: readonly string[];
  readonly inject: readonly AnyServiceKey[];
  readonly uses: readonly string[];
  readonly pointNamespace: string;
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

export interface ServiceProvider {
  readonly owner: string;
  readonly impl: unknown;
}

export interface ServiceSlot {
  readonly key: AnyServiceKey;
  readonly cell: Cell<ServiceProvider>;
}

export function serviceProvider(slot: ServiceSlot | undefined): ServiceProvider | undefined {
  return slot?.cell.entries[0];
}

export interface PointSlot {
  readonly key: PointKey<unknown>;
  readonly cells: Cell<Contribution<unknown>>[];
  /** Ids and aliases, so a lookup and a conflict check are one read. */
  readonly byId: Map<string, Cell<Contribution<unknown>>>;
}

export function pointSlot(key: PointKey<unknown>): PointSlot {
  return { key, cells: [], byId: new Map() };
}

export function refusal(plugin: string, reason: PluginErrorReason, message: string): PluginError {
  return new PluginError({ plugin, reason, message });
}

export function failureOf(plugin: string, cause: Cause.Cause<PluginError>): PluginError {
  const squashed = Cause.squash(cause);
  if (squashed instanceof PluginError) return squashed;
  return refusal(
    plugin,
    "apply-failed",
    squashed instanceof Error ? squashed.message : String(squashed),
  );
}

/** Everything a kernel knows, mutated only inside the effects below. */
export interface State {
  readonly host: KernelHost;
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
export function visible(state: State, owner: string): boolean {
  const entry = state.entries.get(owner);
  if (entry === undefined || !entry.applied) return false;
  return entry.parent === null || visible(state, entry.parent);
}

export function changed(state: State): void {
  state.version++;
  for (const listener of state.subscribers) listener();
}
