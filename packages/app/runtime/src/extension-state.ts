import type { Effect } from "effect";
import type { FileSystem } from "effect/FileSystem";
import type { ExtensionFailure, ExtensionScope, ExtensionSelection } from "@kb/contracts";
import type { ExtensionFolder } from "./extension-folder.ts";
import type { readClosures } from "./extension-loader.ts";

export interface RootSelection {
  readonly links: readonly ExtensionFolder[];
  readonly installed: readonly { name: string; entry: ExtensionSelection; scope: ExtensionScope }[];
  readonly failures: readonly ExtensionFailure[];
}
/** File readings have one root lifetime; imported immutable closures have their own digest lifetime. */
export interface RootExtensionState {
  readonly root: string;
  readonly fingerprint: string;
  selection?: Effect.Effect<RootSelection>;
  readonly closures: Map<
    string,
    Effect.Effect<Effect.Success<ReturnType<typeof readClosures>>, never, FileSystem>
  >;
}
const states = new Map<string, RootExtensionState>();
export function rootExtensionState(root: string, fingerprint: string): RootExtensionState {
  let held = states.get(root);
  if (held === undefined || held.fingerprint !== fingerprint) {
    held = { root, fingerprint, closures: new Map() };
    states.set(root, held);
  }
  return held;
}
export function invalidateRootExtensions(root: string): void {
  states.delete(root);
}
export function resetRootExtensionStates(): void {
  for (const root of states.keys()) invalidateRootExtensions(root);
}
