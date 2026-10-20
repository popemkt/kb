import { Effect, Exit, type Cause } from "effect";
import type { Kernel, Plugin } from "./kernel.ts";

/** One plugin {@link syncPlugins} could not move, and why. */
export interface SyncFailure {
  readonly name: string;
  readonly verb: "load" | "unload";
  readonly cause: Cause.Cause<unknown>;
}

/**
 * What {@link syncPlugins} loaded into each kernel, by name: so a listed
 * plugin that is another value than the one it loaded under that name
 * (a page half re-served from new bytes, a working one after a failed
 * one) replaces it, and the same value is left as it is.
 */
const loadedBy = new WeakMap<Kernel, Map<string, Plugin>>();

/**
 * Converge `kernel` on exactly `plugins`, the one way a host follows a list
 * that moves (the page on the families its server reports, the `kb ui`
 * server on the extensions its store has on): unload each top-level plugin
 * no longer listed, or listed as another value than the one this loaded
 * under its name, then load each listed one the kernel does not hold, in
 * order. A plugin listed as the very value already held is left as it is,
 * so a converged kernel does not move. Unloading takes everything the
 * plugin registered with it, because the kernel ties every contribution to
 * the plugin's scope. A plugin that fails either way is returned, and
 * leaves nothing behind; the rest still converge, so one broken extension
 * never holds the others back.
 */
export const syncPlugins = Effect.fnUntraced(function* (
  kernel: Kernel,
  plugins: readonly Plugin[],
): Effect.fn.Return<readonly SyncFailure[]> {
  const failures: SyncFailure[] = [];
  const loaded = loadedBy.get(kernel) ?? new Map<string, Plugin>();
  loadedBy.set(kernel, loaded);
  const wanted = new Map(plugins.map((plugin) => [plugin.name, plugin]));
  for (const state of kernel.plugins()) {
    if (state.parent !== null) continue;
    const want = wanted.get(state.name);
    const had = loaded.get(state.name);
    if (want !== undefined && (had === undefined || had === want)) continue;
    const exit = yield* Effect.exit(kernel.unload(state.name));
    loaded.delete(state.name);
    if (Exit.isFailure(exit))
      failures.push({ name: state.name, verb: "unload", cause: exit.cause });
  }
  const held = new Set(kernel.plugins().map((state) => state.name));
  for (const plugin of plugins) {
    if (held.has(plugin.name)) continue;
    const exit = yield* Effect.exit(kernel.load(plugin));
    if (kernel.plugins().some((state) => state.name === plugin.name))
      loaded.set(plugin.name, plugin);
    if (Exit.isFailure(exit)) failures.push({ name: plugin.name, verb: "load", cause: exit.cause });
  }
  return failures;
});
