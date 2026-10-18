/**
 * Public type surface of `kb-ext-sdk/page`: what a repository extension's
 * page half (`.kb/extensions/<name>.page.tsx`) builds with. Its values are
 * the page's own host API, `@kb/ui-sdk`, which the page serves to the half
 * it imports (DESIGN-UI.md → Extension UI halves); these are the types of
 * the UI points the shell renders, restated for an author, as
 * `surface.ts` restates the plugin model. React's own types are React's.
 */
// GAP [[01M579MH4HKXE7H51ZA7DRDMNP]] the page surface restates @kb/ui-sdk's point types with nothing holding them equal
import type {
  ComponentPropsWithoutRef,
  ComponentType,
  ForwardRefExoticComponent,
  FunctionComponent,
  ReactElement,
  ReactNode,
  RefAttributes,
} from "react";
import type { ContributionEntry, PointKey, ViewKey } from "./surface.ts";

/** Where a host renders a view: filling the page's box, or inline in the outline's flow. */
export type Placement = "page" | "inline";

/** What a host guarantees a view: never a store. */
export interface ViewHost {
  readonly placement: Placement;
  /** The view node the host draws the view from, when it draws one. */
  readonly viewNode?: string;
}

export interface ViewProps<P> {
  readonly params: P;
  readonly host: ViewHost;
}

/** A view as {@link ViewPoint} holds it, its params erased. */
export interface ProvidedView {
  readonly key: ViewKey<unknown>;
  readonly placements: readonly Placement[];
  readonly sample: unknown;
  readonly Component: FunctionComponent<ViewProps<never>>;
}

/** Every view the page can draw, by its key's id. */
export declare const ViewPoint: PointKey<ProvidedView>;

/** The {@link ViewPoint} contribution drawing `key`, under the key's local id. */
export declare function provideView<P>(
  key: ViewKey<P>,
  view: {
    readonly placements: readonly Placement[];
    /** The params the view contract mounts this view with. */
    readonly sample: P;
    readonly Component: FunctionComponent<ViewProps<P>>;
  },
): ContributionEntry<ProvidedView>;

/** How the shell frames a page. */
export type RouteFrame = "scroll" | "fixed" | "full";

/** A path resolved to a view and its params. */
export interface Route<P> {
  readonly view: ViewKey<P>;
  /** The params when this route owns the path, else `null`. */
  readonly match: (path: string) => P | null;
  readonly frame: (params: P) => RouteFrame;
  readonly pendingTitle: (params: P) => string;
  readonly Chrome?: ComponentType<{ readonly params: P }>;
  /** The path that opens this route's view with nothing chosen. */
  readonly entry?: string;
}

export interface MatchedRoute {
  readonly view: ViewKey<unknown>;
  readonly params: unknown;
}

export interface ResolvedRoute extends MatchedRoute {
  readonly frame: RouteFrame;
  readonly pendingTitle: string;
  readonly chrome: ReactElement | null;
}

/** A route as {@link RoutePoint} holds it. */
export interface ProvidedRoute {
  readonly view: ViewKey<unknown>;
  readonly resolve: (path: string) => ResolvedRoute | null;
  readonly frameOf: (params: unknown) => RouteFrame;
  readonly entry?: string;
}

export declare const RoutePoint: PointKey<ProvidedRoute>;

/** The {@link RoutePoint} contribution for `route`, under its view's local id. */
export declare function provideRoute<P>(route: Route<P>): ContributionEntry<ProvidedRoute>;

/** A section of the sidebar, beside every page. */
export interface SidebarSection {
  /** Lower first. */
  readonly order: number;
  readonly Component: ComponentType<{ readonly route: MatchedRoute | null }>;
}

export declare const SidebarSectionPoint: PointKey<SidebarSection>;

export type IconWeight = "thin" | "light" | "regular" | "bold" | "fill" | "duotone";

export interface IconProps extends ComponentPropsWithoutRef<"svg">, RefAttributes<SVGSVGElement> {
  alt?: string;
  color?: string;
  size?: string | number;
  weight?: IconWeight;
  mirrored?: boolean;
}

/** An icon as the shell's icons are (Phosphor's). */
export type Icon = ForwardRefExoticComponent<IconProps>;

/** A tool window at the workspace's right edge, with a toggle in the header. */
export interface Dock {
  /** Lower first. */
  readonly order: number;
  readonly label: string;
  readonly icon: Icon;
  readonly Component: ComponentType<{ readonly onClose: () => void }>;
}

export declare const DockPoint: PointKey<Dock>;

/** Something mounted once for the whole page, beside every pane. */
export interface Overlay {
  /** Lower first. */
  readonly order: number;
  readonly Component: ComponentType;
}

export declare const OverlayPoint: PointKey<Overlay>;

/** Which node a command is about. */
export interface CommandTarget {
  readonly nodeId: string | null;
  readonly frameId: string | null;
}

/**
 * What a command is handed, as far as a page half reads it: the node it is
 * about. The rest of the page it reaches through the host API.
 */
export interface CommandContext {
  readonly target: CommandTarget;
}

/** A command of the shell's palette and node menu. */
export interface Command {
  readonly id: string;
  readonly scope: "global" | "node";
  /** Absent ⇒ a `sys.command` node names this command. */
  readonly chrome?: (ctx: CommandContext) => { readonly label: string; readonly icon: ReactNode };
  /** Absent ⇒ always offered. */
  readonly when?: (ctx: CommandContext) => boolean;
  readonly run: (ctx: CommandContext) => void | Promise<void>;
}

export declare const CommandPoint: PointKey<Command>;

/** A declared thing's key: the id its option node is named by, and its label. */
export interface SeedOption {
  readonly id: string;
  readonly label: string;
}

/** A design system: one complete set of layer-1 values, as a stylesheet. */
export interface DesignSystem {
  readonly key: SeedOption;
  readonly stylesheet: string;
}

export declare const DesignSystemPoint: PointKey<DesignSystem>;

/** The design system its family declares as `key`, as its page half contributes it. */
export declare function provideDesignSystem(
  key: SeedOption,
  system: { readonly stylesheet: string },
): ContributionEntry<DesignSystem>;
