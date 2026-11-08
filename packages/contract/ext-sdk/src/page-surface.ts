/**
 * Public type surface of `kb-ext-sdk/page`: what a repository extension's
 * page half (`.kb/extensions/<name>.page.tsx`) builds with. Its values are
 * the page's own host API, `@kb/ui-sdk`, which the page serves to the half
 * it imports (DESIGN-UI.md → Extension UI halves); these are the types of
 * the UI points the shell renders, restated for an author, as
 * `surface.ts` restates the plugin model. React's own types are React's.
 * `@kb/ui-sdk`'s `page-surface-bridge.test.ts` holds the restatement to the
 * values the page serves.
 */
import type {
  ComponentPropsWithoutRef,
  ComponentType,
  ForwardRefExoticComponent,
  FunctionComponent,
  ReactElement,
  ReactNode,
  RefAttributes,
} from "react";
import type {
  BackdropDirection,
  BackdropStrength,
  ContributionEntry,
  KnobValues,
  PlainViewKey,
  PointKey,
  PointName,
  SeedBackdrop,
  ViewKey,
} from "./surface.ts";

/**
 * Where a host renders a view: filling the page's box, inline in the
 * outline's flow, as a compact read-only preview under a node's row, which
 * a view draws exactly when its key says so (`ViewKey.preview`), or as a
 * node's row itself, in place of its text while no one edits it, for the
 * nodes of a tag that names it (`tagRowViews`, `sys.f.view.row`).
 */
export type Placement = "page" | "inline" | "preview" | "row";

/** The placements a contribution lists itself: `preview` is its key's to say. */
export type ListedPlacement = Exclude<Placement, "preview">;

/**
 * The row a view at placement `row` draws: the node the row shows and its
 * text, all of the graph it is handed. `text` is that text drawn as the
 * outline draws it; pressing it edits the row there, so a view places it.
 */
export interface RowSubject {
  readonly id: string;
  /** The text as written: inline markdown, a reference as `[[id|label]]`. */
  readonly markdown: string;
  readonly text: ReactNode;
}

/** Where a host draws a view, with what it hands the view there: at `row`, the row it draws; elsewhere, no row. */
export type Drawn =
  | { readonly placement: "row"; readonly row: RowSubject }
  | { readonly placement: Exclude<Placement, "row">; readonly row?: undefined };

/** What a host guarantees a view: never a store. */
export type ViewHost = Drawn & {
  /** The view node the host draws the view from, when it draws one. */
  readonly viewNode?: string;
};

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
  key: PlainViewKey<P>,
  view: {
    readonly placements: readonly ListedPlacement[];
    /** The params the view contract mounts this view with. */
    readonly sample: P;
    readonly Component: FunctionComponent<ViewProps<P>>;
  },
): ContributionEntry<ProvidedView>;

/**
 * How a page is framed inside its pane, under the shell's header, which is
 * drawn above every page whatever its frame: `scroll`, a scroll region
 * around it; `fixed`, a box of the pane's size; `full`, nothing, the page
 * fills the pane and frames itself (its own scrolling, its own toolbar).
 */
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

/**
 * The node menu's groups, in the order it lists them: how the node itself
 * opens and shows, what it is and holds, where it opens, where it sits,
 * what marks it, how its views show it, and removing it.
 */
export type NodeMenuGroup = "lead" | "make" | "open" | "arrange" | "mark" | "view" | "remove";

/**
 * Where a command is offered. `global`: ⌘K, which lists the `sys.command`
 * node of the command's id, a node the family's seed declares, and so names
 * it. `node`: the node menu, about its row, in its `group`, then by `order`
 * (lower first), then in the order the commands were contributed.
 */
export type CommandMenu =
  | { readonly where: "global" }
  | { readonly where: "node"; readonly group: NodeMenuGroup; readonly order: number };

/** A command ⌘K offers by its `sys.command` node. */
export interface GlobalCommand {
  readonly id: string;
  readonly menu: { readonly where: "global" };
  /** Absent ⇒ always offered. */
  readonly when?: (ctx: CommandContext) => boolean;
  readonly run: (ctx: CommandContext) => void | Promise<void>;
}

/** A command of the node menu, which names itself. */
export interface NodeCommand {
  readonly id: string;
  readonly menu: { readonly where: "node"; readonly group: NodeMenuGroup; readonly order: number };
  readonly chrome: (ctx: CommandContext) => { readonly label: string; readonly icon: ReactNode };
  /** Absent ⇒ always offered. */
  readonly when?: (ctx: CommandContext) => boolean;
  readonly run: (ctx: CommandContext) => void | Promise<void>;
}

/** A command of the shell's ⌘K palette or its node menu. */
export type Command = GlobalCommand | NodeCommand;

export declare const CommandPoint: PointKey<Command>;

/**
 * An action as data: its id, and its input. It is about a row, so the
 * row's node is added to the input as `id`; a picker step's pick fills
 * each {@link PICKED} in it. kb calls it through the page's one invoke
 * path, under the guards every call meets, and tells a person when it fails.
 */
export interface ActionCall {
  readonly action: string;
  readonly input?: Readonly<Record<string, unknown>>;
}

/** Where a picker step's input takes the node the person picked. */
export interface Picked {
  readonly $: "picked";
}

/** The value a picker step's pick replaces, wherever it stands in the input. */
export declare const PICKED: Picked;

/** An icon a form names: one the shell's own rows draw. */
export type IconName =
  | "arrow-right"
  | "check"
  | "eye"
  | "hash"
  | "link"
  | "magnifying-glass"
  | "pin"
  | "plus"
  | "star"
  | "text"
  | "trash";

/**
 * The {@link CommandPoint} contribution for a node command written as
 * data, its T0 form: a label, an icon by name, where the node menu lists
 * it, a query node (by id) whose answer's first column holds the rows it is
 * offered on (absent, every row), and what it runs: an action about the
 * row, or a picker step to open, by its contribution's id. A group that is
 * not the menu's, or an icon kb does not name, throws where the plugin
 * applies.
 */
export declare function provideCommand(
  id: string,
  form: {
    readonly label: string;
    readonly icon?: IconName;
    readonly group: NodeMenuGroup;
    readonly order: number;
    readonly when?: string;
    readonly run: ActionCall | { readonly step: string };
  },
): ContributionEntry<Command>;

/** What a picker step offers: a node, by id, and the text that names it. */
export interface PickerCandidate {
  readonly id: string;
  readonly label: string;
}

/**
 * One picker step of the node palette, which a node command opens by its
 * contribution's id. As a page half writes it, it is handed the row the
 * palette is anchored to, and the node picked or named; the rest of the
 * page it reaches through the host API, as a command does.
 */
export interface PaletteStep {
  readonly label: string;
  readonly placeholder: string;
  readonly icon: ReactNode;
  /** Absent ⇒ nothing can be minted from the picker. */
  readonly createLabel?: (name: string) => string;
  readonly candidates: (graph: { readonly anchorId: string | null }) => PickerCandidate[];
  /** At most this many rows; absent, every match. */
  readonly limit?: number;
  readonly commit: (pick: {
    readonly targetNodeId: string;
    readonly pickedId: string;
    readonly creating: boolean;
    readonly name: string;
  }) => Promise<void>;
}

/**
 * The node palette's picker steps, by id: a point the shell declares, so a
 * plugin that contributes one names it in `uses` and reaches it with
 * `ctx.point(PaletteStepPoint)`.
 */
export declare const PaletteStepPoint: PointName<PaletteStep>;

/**
 * The {@link PaletteStepPoint} contribution for a picker step written as
 * data, its T0 form: the page runs the picker over the nodes a query node
 * (by id) answers in its first column, less the row itself, each named by
 * its text, and a pick calls `commit` about the row, the pick filling each
 * {@link PICKED} in its input.
 */
export declare function providePaletteStep(
  id: string,
  form: {
    readonly label: string;
    readonly placeholder: string;
    readonly icon?: IconName;
    readonly candidates: string;
    readonly limit?: number;
    readonly commit: ActionCall;
  },
): ContributionEntry<PaletteStep>;

/**
 * A key as a binding states it: a key name as `KeyboardEvent.key` names
 * it (or several, or a test of the name), and the modifiers it asks about.
 * A modifier left out is not asked about. `mod` is ⌘ or Ctrl.
 */
export interface Chord {
  key?: string | readonly string[] | ((key: string) => boolean);
  mod?: boolean;
  meta?: boolean;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
}

/**
 * Where a key means something: the outline's row being edited, or its
 * selection (a row selected, none edited).
 */
export type KeyContextId = "outline.editing" | "outline.selection";

/**
 * What a key runs: one of its context's intents by name (`outline.editing`:
 * `split`, `indent`, `move-up`, `line-down`, …; `outline.selection`: `up`,
 * `move-down`, `create-after`, `zoom`, …), or an action through the page's
 * invoke path, with the row's node as its input's `id`.
 */
export type KeyRun = { readonly intent: string } | ActionCall;

/** A key in a context, and what it runs; the binding whose held chord it takes, if any. */
export interface Keybinding {
  readonly context: string;
  readonly chord: Chord;
  readonly run: KeyRun;
  readonly replaces?: string;
}

/**
 * Every key of the outline's contexts. One binding per chord per context:
 * the outline's own are held first (`outline.editing.split`,
 * `outline.selection.up`, …). A binding over a held chord is refused, and
 * the person told why, unless it names the holder in `replaces`; it then
 * takes exactly its own chord, and the holder keeps the rest. `Escape`,
 * ⌘Z, ⌘⇧Z and ⌘K are never a binding's.
 */
export declare const KeybindingPoint: PointKey<Keybinding>;

/**
 * The {@link KeybindingPoint} contribution for a binding written as data:
 * its chord as text, modifiers then the key, joined by `-` (`Alt-ArrowUp`,
 * `Mod-Shift-k`), exact, so a modifier it does not name must be up. `Mod`
 * is ⌘ or Ctrl; a letter matches in either case, Shift being its flag.
 */
export declare function provideKeybinding(
  id: string,
  binding: {
    readonly context: KeyContextId;
    readonly chord: string;
    readonly run: KeyRun;
    readonly replaces?: string;
  },
): ContributionEntry<Keybinding>;

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

/**
 * How far across the page a backdrop's frame reaches: centred under the
 * head's content and at most `maxWidth` wide, or across the whole scroll
 * region behind it.
 */
export type BackdropSpan =
  | { readonly reach: "content"; readonly maxWidth: number }
  | { readonly reach: "region" };

/**
 * How a page head frames a backdrop: the breathing room it reserves above
 * the head's content, its frame's height, span and vertical offset, the
 * directions it can face (none, when it has no direction), and how opaque
 * it is at each strength.
 */
export interface BackdropPresentation {
  readonly space: number;
  readonly height: number;
  readonly span: BackdropSpan;
  readonly offset: number;
  readonly directions: readonly BackdropDirection[];
  readonly opacity: Readonly<Record<BackdropStrength, number>>;
}

/** What a backdrop may spend drawing one frame, in ms: of the GPU's time, or the main thread's. */
export interface BackdropBudget {
  readonly frameMs: number;
}

/**
 * The page head's frame budget, by what draws a backdrop: 6 ms of the
 * GPU's time for a GPU scene, 2 ms of the main thread for a canvas scene,
 * 1 ms for one the page's CSS draws. A contribution names the one that
 * applies, or less, never more.
 */
export declare const BACKDROP_BUDGETS: {
  readonly gpu: { readonly frameMs: 6 };
  readonly canvas: { readonly frameMs: 2 };
  readonly dom: { readonly frameMs: 1 };
};

/** What has happened on the page, counted since it loaded. */
export interface PageEvents {
  /** Changes made elsewhere it has been shown. */
  readonly arrivals: number;
  /** Errors it has told the owner of. */
  readonly errors: number;
  /** Turns the sidebar's agent has finished with an answer. */
  readonly turns: number;
}

/**
 * What the owner is doing on the page: whether a node's text is being
 * edited, how many writes the graph has taken, and what has happened. A
 * backdrop compares a count with the one it last saw.
 */
export interface PageActivity extends PageEvents {
  readonly editing: boolean;
  readonly writes: number;
}

/** The pointer over a backdrop's own frame, polled in its own loop. */
export interface PointerSource {
  /** Where the pointer is, in CSS pixels from the frame's corner; null when it is not over it. */
  readonly now: () => { readonly x: number; readonly y: number } | null;
}

/**
 * What a page head hands the backdrop it shows: what every backdrop is
 * handed. The node it shows is declared by its id, which is what a
 * backdrop that answers navigation reads.
 */
// GAP [[01M6WVFMGB5PP2AANF0E5R921V]] a trusted backdrop has the page's power; these types confine nothing
export interface BackdropProps {
  /** The head's colour: the shown node's tag colour, else the accent. */
  readonly color: string;
  /** The node the head shows, when it shows one. */
  readonly node: { readonly id: string } | undefined;
  readonly strength: BackdropStrength;
  readonly direction: BackdropDirection;
  /** The file of kb's assets naming art to draw in place of its own; null, its own. */
  readonly art: string | null;
  /** The variant it shows, by local id; null for a backdrop with none. */
  readonly variant: string | null;
  /** The presentation's opacity at `strength`. */
  readonly opacity: number;
  /** Its knobs' values, by id: each knob's default where nothing sets it. */
  readonly knobs: KnobValues;
  /** What it may spend a frame. */
  readonly budget: BackdropBudget;
  /** What the owner is doing on the page now. */
  readonly activity: PageActivity;
  readonly pointer: PointerSource;
}

/**
 * A page-head backdrop: its key (the backdrop its declaration names), how
 * a head frames it, what it may spend a frame, and its scene, the
 * component the slot draws wherever it is shown (a head, a card, the
 * studio).
 */
/**
 * What a backdrop can be seen to answer: the pointer over its frame, a
 * move to another page, or one of the things its activity says the owner
 * does (`PageActivity`: typing in a node is `editing`).
 */
export type BackdropCue = "pointer" | "navigation" | keyof PageActivity;

/** One thing a backdrop does when its cue moves, said in a line ("ripples follow the cursor"). */
export interface BackdropInteraction {
  readonly cue: BackdropCue;
  readonly does: string;
}

export interface Backdrop {
  readonly key: SeedBackdrop;
  readonly presentation: BackdropPresentation;
  readonly budget: BackdropBudget;
  /** What it answers, as Backdrop Studio lists them and lets a person try them; none, for one that answers nothing. */
  readonly interactions: readonly BackdropInteraction[];
  /** A function component: what the slot hands it may be more than its props declare. */
  readonly Component: FunctionComponent<BackdropProps>;
}

/** Every backdrop a page head can show. */
export declare const BackdropPoint: PointKey<Backdrop>;

/**
 * The backdrop its family declares as `key`, as its page half contributes
 * it: under the key's local id, so it answers to the declared id.
 */
export declare function provideBackdrop(
  key: SeedBackdrop,
  backdrop: Omit<Backdrop, "key">,
): ContributionEntry<Backdrop>;

/**
 * What one recorded cost measures: the main thread's time drawing the
 * frame, the GPU's, or the interval since the last frame.
 */
export type FrameCost = "frame" | "gpu" | "interval";

/** A backdrop's frames held to its budget, and the detail it draws at. */
export interface FrameMeter {
  /** 1 at full detail, down to the floor while frames run over budget. */
  readonly quality: () => number;
  /** Record one frame's cost in ms (`frame` unless it says): true when quality just stepped down. */
  readonly record: (ms: number, cost?: FrameCost) => boolean;
}

export interface FrameMeterOptions {
  /** The lowest quality it steps down to (by default 0.45). */
  readonly floor?: number;
}

/**
 * Meter `canvas`'s frames against `budget`, as every metered backdrop is:
 * over budget for long enough, quality steps down, and the canvas carries
 * what was measured, which Backdrop Studio's readout reads.
 */
export declare function meterFrames(
  canvas: HTMLCanvasElement,
  budget: BackdropBudget,
  options?: FrameMeterOptions,
): FrameMeter;

/** Whether the owner asks for reduced motion: a backdrop then draws one still frame. */
export declare function useReducedMotion(): boolean;
