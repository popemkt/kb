/**
 * The route point (DESIGN-UI.md → UI points: routes and views): a path
 * resolved to a view and its params, and how the shell frames the page.
 */
import { createElement, type ComponentType, type ReactElement } from "react";
import { CORE_POINT_DEFINITIONS } from "@kb/contracts";
import { Point, type Contribution, type ContributionEntry } from "@kb/plugin";
import { localIdOf, type ViewKey } from "@kb/views";
import { useContributions } from "./plugins.ts";
import { usePath } from "./router";
import type { ProvidedView } from "./view-point.ts";

/**
 * How a page is framed in its pane, under the shell's header, which every
 * page is drawn under: `scroll`, a scroll region around it; `fixed`, a box
 * of the pane's size (a canvas owns its own viewport, so it does not
 * scroll); `full`, nothing, the page fills the pane and frames itself.
 */
export type RouteFrame = "scroll" | "fixed" | "full";

/** A path resolved to a view and its params; it owns no page component. */
export interface Route<P> {
  readonly view: ViewKey<P>;
  /**
   * The params when this route owns the path, else `null`. A path no route
   * owns is not found; no route takes "whatever is left".
   */
  readonly match: (path: string) => P | null;
  readonly frame: (params: P) => RouteFrame;
  /** Shown while the workspace loads under this route. */
  readonly pendingTitle: (params: P) => string;
  /** Rendered above the page, outside its scroll region (a scope bar). */
  readonly Chrome?: ComponentType<{ readonly params: P }>;
  /**
   * The path that opens this route's view with nothing chosen (`/graph`,
   * `/canvas`), for a route that has one: where a pane's view switcher sends
   * a pane to show this view.
   */
  readonly entry?: string;
}

/** The page a path resolved to: which view, with what params. */
export interface MatchedRoute {
  readonly view: ViewKey<unknown>;
  readonly params: unknown;
}

/** A matched route with what the shell frames it with, read off the route. */
export interface ResolvedRoute extends MatchedRoute {
  readonly frame: RouteFrame;
  readonly pendingTitle: string;
  readonly chrome: ReactElement | null;
}

/** A route as the point holds it: resolving a path keeps its params typed inside. */
export interface ProvidedRoute {
  readonly view: ViewKey<unknown>;
  readonly resolve: (path: string) => ResolvedRoute | null;
  /** How the route frames its view's page for `params`, which must be that view's. */
  readonly frameOf: (params: unknown) => RouteFrame;
  readonly entry?: string;
}

export const RoutePoint = Point<ProvidedRoute>()(
  CORE_POINT_DEFINITIONS.route.name,
  CORE_POINT_DEFINITIONS.route.spec,
);

/**
 * `route`'s params for `path`, or null when it is not the route's — or when
 * the route cannot read it: a malformed escape (`/canvas/%E0%A4%A`) makes
 * `decodeURIComponent` throw, and a path no route can read is no route's,
 * never a crash of the shell that resolves it.
 */
function matchPath<P>(route: Route<P>, path: string): P | null {
  try {
    return route.match(path);
  } catch (error) {
    if (error instanceof URIError) return null;
    throw error;
  }
}

export function provideRoute<P>(route: Route<P>): ContributionEntry<ProvidedRoute> {
  const { Chrome } = route;
  return {
    id: localIdOf(route.view),
    value: {
      view: route.view,
      frameOf: (params) => route.frame(asParamsOf(route.view, params)),
      ...(route.entry === undefined ? {} : { entry: route.entry }),
      resolve: (path) => {
        const params = matchPath(route, path);
        if (params === null) return null;
        return {
          view: route.view,
          params,
          frame: route.frame(params),
          pendingTitle: route.pendingTitle(params),
          chrome: Chrome === undefined ? null : createElement(Chrome, { params }),
        };
      },
    },
  };
}

/** A matched route's params read as the `P` their key stands for: typed by this very key in `provideRoute`. */
function asParamsOf<P>(_key: ViewKey<P>, params: unknown): P {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- typed by this very key in provideRoute; identity checked by the caller
  return params as P;
}

/** The params of `route` when it renders `key`, else null. */
export function paramsOf<P>(route: MatchedRoute | null, key: ViewKey<P>): P | null {
  return route?.view === key ? asParamsOf(key, route.params) : null;
}

/**
 * How `key`'s page is framed when it shows `params`: as the route that opens
 * that view frames it, else as the view says a page it is the whole of is
 * framed (`View.frame`), or null when neither says. A host that shows a view
 * no route led to (a node opened in its default view) frames it so.
 */
export function pageFrameOf<P>(
  routes: readonly Contribution<ProvidedRoute>[],
  views: readonly Contribution<ProvidedView>[],
  key: ViewKey<P>,
  params: P,
): RouteFrame | null {
  const route = routes.find(({ value }) => value.view === key);
  if (route !== undefined) return route.value.frameOf(params);
  return views.find(({ value }) => value.key === key)?.value.frame ?? null;
}

/** The route that owns `path`, or null when none does; the first match wins. */
export function matchRoute(
  routes: readonly Contribution<ProvidedRoute>[],
  path: string,
): ResolvedRoute | null {
  for (const route of routes) {
    const resolved = route.value.resolve(path);
    if (resolved !== null) return resolved;
  }
  return null;
}

/** The current route, as the registered routes resolve it. */
export function useRoute(): ResolvedRoute | null {
  const path = usePath();
  const routes = useContributions(RoutePoint);
  return matchRoute(routes, path);
}
