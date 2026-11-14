/**
 * The browser's plugin kernel, which the UI is assembled from.
 *
 * The same `@kb/plugin` kernel the server loads extensions into runs here, so
 * a page is a contribution, not a branch in the shell: a plugin (a shell
 * folder, or a family's `-ui` package) contributes its views, the routes that
 * lead to them, and the sidebar section that lists them, and the shell renders
 * whatever is registered. Unloading a plugin removes all three, because the
 * kernel ties every contribution to the plugin's scope.
 *
 * Each point lives in its own module (`view-point.ts`, `route-point.ts`,
 * `shell-points.ts`); their contract is stated once, in DESIGN-UI.md → UI
 * points: routes and views.
 */
import { useCallback, useMemo, useSyncExternalStore, type ComponentType } from "react";
import { Cause, Effect } from "effect";
import { runtimeFootprint, type FamilyKernel, type FootprintRow } from "@kb/contracts";
import {
  makeKernel,
  syncPlugins,
  type Contribution,
  type Kernel,
  type Plugin,
  type PointReference,
  type ServiceKey,
  type RoleKey,
  roleCall,
} from "@kb/plugin";
import { isFrameViewKey, type FrameViewKey, type ViewKey } from "@kb/views";
import { roleSelections, type KbNode } from "@kb/model";
import { roleComponent } from "./roles";
import { toast } from "./toast";
import type { FamilyView } from "./view-key";
import { familyViews, findView, ViewPoint, type View } from "./view-point.ts";

/** One kernel per page: everything the UI shows is contributed to it. */
const uiKernel = makeKernel({ host: "page" });

/**
 * Converge the UI kernel on exactly `plugins` (`syncPlugins`, the one
 * convergence every host uses): a top-level plugin no longer listed unloads,
 * and its routes, views and sidebar section go with it, live. A plugin that
 * fails is reported and leaves nothing behind; the rest of the UI still
 * loads.
 */
export function syncUiPlugins(plugins: readonly Plugin[]): void {
  for (const { name, verb, cause } of Effect.runSync(syncPlugins(uiKernel, plugins))) {
    const failure = Cause.squash(cause);
    toast(
      `UI plugin ${name} failed to ${verb}: ${failure instanceof Error ? failure.message : String(failure)}`,
    );
  }
}

/** Per-store choices derived by the host from role nodes. */
export function configureUiRoles(
  nodeOf: (id: string) => Pick<KbNode, "id" | "props"> | undefined,
): void {
  Effect.runSync(uiKernel.configureRoles(roleSelections(uiKernel.roles(), nodeOf)));
}

/** The page's admitted claim for one exact role, shared with candidate registration. */
// GAP [[01M6YS6XH9XS4TX7S7AYWXJX3A]] prepared for the owner-blocked keybinding follow-up
export function replacementApproved(owner: string, role: string): boolean {
  return uiKernel.replacementApproved(owner, role);
}

/** Role consumers get a stable boundary rather than the unguarded implementation. */
export function useRole<P extends object>(role: RoleKey<ComponentType<P>>): ComponentType<P> {
  return roleComponent(uiKernel, role);
}

/**
 * Call a page service role's elected provider (`roleCall`): a replacement
 * that dies or overruns `budgetMs` is demoted and the next candidate tried,
 * down to the role's default. A call that fails there rejects; the role's
 * failure is the caller's to report, never a second default path.
 */
export function callPageRole<C, A>(
  role: RoleKey<C>,
  invoke: (provider: C) => Promise<A>,
  budgetMs: number,
): Promise<A> {
  return Effect.runPromise(
    roleCall(uiKernel, role, (provider) => Effect.promise(() => invoke(provider)), budgetMs),
  );
}

/** Called after every change to the page kernel's plugins, services or contributions. */
export const subscribeUiKernel = uiKernel.subscribe;

/**
 * The page kernel as the kernel the page holds families in: what the
 * Settings' Extensions part reads the page's half of a family's organisation and
 * ordered points from, beside the server's (`extension.list`).
 */
export const PAGE_FAMILY_KERNEL: FamilyKernel = { source: "page", kernel: uiKernel };

/**
 * A family's footprint on the page (DESIGN.md → Extension families →
 * footprint): what its browser entry, children included, contributed to
 * `kernel`, the page's own by default, as rows from `page`. The server's
 * rows come from `extension.footprint`; Settings joins the two.
 */
export function pageFootprint(family: string, kernel: Kernel = uiKernel): readonly FootprintRow[] {
  return runtimeFootprint(family, { source: "page", kernel });
}

/**
 * A reader for one point that returns the same array until the kernel moves.
 * `useSyncExternalStore` compares snapshots by identity, and the kernel hands
 * out a fresh array per read.
 */
export function pointReader<C>(point: PointReference<C>): () => readonly Contribution<C>[] {
  let version = -1;
  let items: readonly Contribution<C>[] = [];
  return () => {
    if (uiKernel.version() !== version) {
      version = uiKernel.version();
      items = uiKernel.contributions(point);
    }
    return items;
  };
}

/**
 * The page kernel as something to read, never to load into: its points, the
 * plugins it holds, and its version. What the page's own invoke reads its
 * guards and interceptors from.
 */
export const uiKernelReader: Pick<Kernel, "contributions" | "plugins" | "provenance" | "version"> =
  {
    contributions: (point) => uiKernel.contributions(point),
    provenance: uiKernel.provenance,
    plugins: () => uiKernel.plugins(),
    version: () => uiKernel.version(),
  };

/** A point's contributions now, for a reader outside React (a port the shell wires). */
export function currentContributions<C>(point: PointReference<C>): readonly Contribution<C>[] {
  return uiKernel.contributions(point);
}

/** The service provided under `key` now, or undefined while no plugin provides it. */
export function currentService<S>(key: ServiceKey<S>): S | undefined {
  return uiKernel.service(key);
}

/** A service as provided now, or undefined while none is; re-read whenever the kernel changes. */
export function useService<S>(key: ServiceKey<S>): S | undefined {
  const read = useCallback(() => uiKernel.service(key), [key]);
  return useSyncExternalStore(uiKernel.subscribe, read, read);
}

/** A point's contributions, re-read whenever the kernel changes. */
export function useContributions<C>(point: PointReference<C>): readonly Contribution<C>[] {
  const read = useMemo(() => pointReader(point), [point]);
  return useSyncExternalStore(uiKernel.subscribe, read, read);
}

/** The view provided under `key` now, for a reader outside React. */
export function currentView<P>(key: ViewKey<P>): View<P> | null {
  return findView(uiKernel, key);
}

/** The view provided under `key`, live: null while its owner is unloaded. */
export function useView<P>(key: ViewKey<P>): View<P> | null {
  const read = useCallback(() => currentView(key), [key]);
  return useSyncExternalStore(uiKernel.subscribe, read, read);
}

/**
 * The frame views provided now, in their pickers' order: what a frame's row
 * walk lays its rows out by and the view commands offer (`familyViews`).
 */
export function providedFrameViews(): readonly FamilyView<FrameViewKey>[] {
  return familyViews(currentContributions(ViewPoint), isFrameViewKey);
}

// GAP [[01M79H9PY7XVHHVGAN1WA3VYAF]]: belongs beside BackdropPoint in @kb/appearance-kit; its `canvas`
// key reads as a family name there, and that debt may not move to a new file.
/**
 * What a backdrop may spend drawing one frame (DESIGN-UI.md → Page-head
 * backdrops → The surface): milliseconds of the GPU's time for a GPU scene,
 * of the main thread's for a canvas one. A host that meters its frames
 * holds the backdrop to it, stepping its quality down while it runs over.
 */
export interface BackdropBudget {
  readonly frameMs: number;
}

/**
 * The page head's frame budget, by what draws a backdrop: a third of a 60 Hz
 * frame of the GPU's time for a GPU scene, 2 ms of the main thread for a
 * canvas scene, and 1 ms for one the page's own layout and CSS draw, which
 * no host meters (GAP [[01M6RT9R6AXGVYZWCSTG26EET8]]). A contribution names the one that
 * applies; one that needs less may declare less, never more.
 */
export const BACKDROP_BUDGETS = {
  gpu: { frameMs: 6 },
  canvas: { frameMs: 2 },
  dom: { frameMs: 1 },
} as const satisfies Record<string, BackdropBudget>;
