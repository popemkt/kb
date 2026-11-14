/**
 * The command point: what a command is, what it is handed, and where a plugin
 * contributes one (DESIGN-UI.md → Extension UI halves). The shell's own
 * commands and the registry over them are `lib/commands.tsx`; a feature's
 * command reaches the palette and the node menu through {@link CommandPoint}
 * and needs nothing else of the shell. A picker a node command hands the node
 * palette to is a {@link PaletteStep}, contributed through
 * {@link PaletteStepPoint} by whichever family owns it.
 */
import { CORE_POINT_DEFINITIONS } from "@kb/contracts";
import { Effect } from "effect";
import type { ReactNode } from "react";
import { Point, PointName, definePlugin } from "@kb/plugin";
import type { WireNode } from "@kb/contracts";
import type { FrameViewKey, LayoutTree } from "@kb/views";
import type { ThemePref, WidthPref } from "./theme";
import type { PickerCandidate } from "./picker";
import type { SchemaIndex } from "./schema";
import type { NodeMap } from "./types";
import type { FamilyView } from "./view-key";
import { browserHost } from "../host";

/** What commands read and drive on the outline store. */
export interface OutlineCommandApi {
  readonly selectedNodeId: string | null;
  /** The node the page stands at: the one its focused pane is shown for, a zoom or a node opened there. */
  readonly rootNodeId: string;
  readonly ontologyId: string | null;
  readonly nodes: NodeMap;
  readonly wireNodes: WireNode[];
  jumpToNode: (id: string) => void;
  zoomTo: (id: string) => void;
  /** Leave the ontology scope for where the page stood before it entered. */
  leaveScope: () => void;
  /** The frame views provided, in their pickers' order. */
  frameViews: () => readonly FamilyView<FrameViewKey>[];
}

interface PrefsCommandApi {
  readonly theme: ThemePref;
  readonly width: WidthPref;
  setTheme: (theme: ThemePref) => void;
  setWidth: (width: WidthPref) => void;
}

interface UiCommandApi {
  setGlobalPaletteOpen: (open: boolean) => void;
  setViewSettingsFrameId: (id: string | null) => void;
}

/** What commands read and drive on the workspace (its panes and their arrangement). */
interface WorkspaceCommandApi {
  readonly layout: LayoutTree;
  readonly focused: string;
  openBeside: (beside: string, path: string) => string;
  close: (id: string) => void;
  replace: (layout: LayoutTree) => void;
  save: (text: string) => Promise<string | null>;
}

interface DebugFieldsCommandApi {
  readonly ids: ReadonlySet<string>;
  toggle: (nodeId: string) => void;
}

/** The palette shell a command can dismiss or send to a picker step, by its contribution's id. */
export interface PaletteSurface {
  close: () => void;
  openStep: (step: string) => void;
}

/** What a palette step's candidates are drawn from. */
interface PaletteStepGraph {
  readonly nodes: NodeMap;
  readonly wireNodes: readonly WireNode[];
  /** The row the palette is anchored to: never its own candidate. */
  readonly anchorId: string | null;
  /** Every row the step is about, the anchored one among them: none is its own candidate. */
  readonly targetNodeIds: readonly string[];
}

/** What a palette step's pick writes: the rows it is about, and the candidate picked or named. */
interface PaletteStepPick {
  /** The row the palette is anchored to. */
  readonly targetNodeId: string;
  /**
   * Every row the step is about, the anchored one among them: a selection's
   * rows (DESIGN-UI.md → Outline editor, "A selection is a range of rows").
   * A step a command that acts on many opens writes the pick to each.
   */
  readonly targetNodeIds: readonly string[];
  /** Where field definitions are read from: the whole graph (`lib/schema.ts`). */
  readonly schema: SchemaIndex;
  readonly pickedId: string;
  readonly creating: boolean;
  readonly name: string;
  /** Picked the step's alternate way (`PaletteStep.alternate`): Alt+Enter, or an Alt-click. */
  readonly alternate: boolean;
}

/**
 * One picker step of the node palette, whole: every step is the same gesture
 * over one picker engine (`lib/picker`), so only the candidate source,
 * whether a new one may be minted, and the write vary.
 */
export interface PaletteStep {
  readonly label: string;
  readonly placeholder: string;
  readonly icon: ReactNode;
  /** Absent ⇒ nothing can be minted from the picker. */
  readonly createLabel?: (name: string) => string;
  readonly candidates: (graph: PaletteStepGraph) => PickerCandidate[];
  /** At most this many rows; absent, every match. */
  readonly limit?: number;
  /**
   * What a pick made with Alt does, said under the list ("Move and leave a
   * reference"); absent, Alt picks as Enter does.
   */
  readonly alternate?: string;
  readonly commit: (pick: PaletteStepPick) => Promise<void>;
}

/**
 * The node palette's picker steps, by id: a node command opens one with
 * `palette.openStep(id)`. A family's steps come and go with it.
 */
export const PaletteStepPoint = PointName<PaletteStep>()(CORE_POINT_DEFINITIONS.paletteStep.name);

/**
 * Which node a command is about.
 *
 * `nodeId` and `frameId` answer different questions, which is why they are two
 * fields: `nodeId` is "which row is this command about" and includes `sys.*`
 * schema rows, whose hidden props are exactly the ones worth revealing;
 * `frameId` is "which frame owns the view config" and excludes them.
 */
export interface CommandTarget {
  readonly nodeId: string | null;
  readonly frameId: string | null;
  /**
   * Every row the command is about, `nodeId` among them: a selection's rows
   * (DESIGN-UI.md → Outline editor, "A selection is a range of rows"), the
   * one row otherwise, none with no node.
   */
  readonly nodeIds: readonly string[];
}

export interface CommandContext {
  readonly target: CommandTarget;
  readonly outline: OutlineCommandApi;
  readonly prefs: PrefsCommandApi;
  readonly ui: UiCommandApi;
  readonly debugFields: DebugFieldsCommandApi;
  readonly workspace: WorkspaceCommandApi;
  readonly palette: PaletteSurface;
}

/** A command's own label and icon, for commands no node names. */
interface CommandChrome {
  readonly label: string;
  readonly icon: ReactNode;
}

/**
 * The node menu's groups, in the order it lists them: how the node itself
 * opens and shows, what it is and holds, where it opens, where it sits,
 * what marks it, how its views show it, and removing it.
 */
export const NODE_MENU_GROUPS = [
  "lead",
  "make",
  "open",
  "arrange",
  "mark",
  "view",
  "remove",
] as const;

export type NodeMenuGroup = (typeof NODE_MENU_GROUPS)[number];

/**
 * Where a command is offered (DESIGN-UI.md → The node menu). `global`: ⌘K,
 * which lists the `sys.command` node of the command's id and so names it.
 * `node`: the node menu, about its row, in its `group`, then by `order`
 * (lower first), then in the order the commands were contributed.
 */
type CommandMenu =
  | { readonly where: "global" }
  | { readonly where: "node"; readonly group: NodeMenuGroup; readonly order: number };

/** The node menu's place for a command: `group`, then `order` in it. */
export function nodeMenu(group: NodeMenuGroup, order: number): NodeCommand["menu"] {
  return { where: "node", group, order };
}

interface CommandBase {
  readonly id: string;
  /** Absent ⇒ always offered. */
  readonly when?: (ctx: CommandContext) => boolean;
  readonly run: (ctx: CommandContext) => void | Promise<void>;
}

/** A command ⌘K offers by its `sys.command` node, which names it. */
interface GlobalCommand extends CommandBase {
  readonly menu: { readonly where: "global" };
}

/** A command of the node menu: nothing in the graph names it, so it names itself. */
export interface NodeCommand extends CommandBase {
  readonly menu: Extract<CommandMenu, { readonly where: "node" }>;
  readonly chrome: (ctx: CommandContext) => CommandChrome;
  /**
   * Offered over a selection of several rows, and run on each
   * (`nodeAction`); absent, only on one row.
   */
  readonly many?: true;
  /**
   * The global command (its `sys.command` id) this is the node menu's face
   * of: the one act, there on the page's frame, here on this node. Where ⌘K
   * lists a node's commands, it lists this row in that one's place.
   */
  readonly faceOf?: string | undefined;
}

export type Command = GlobalCommand | NodeCommand;

/**
 * Commands a plugin contributes beside its views (the chart's "Add chart").
 * The node menu lists them where their `menu` puts them; the runner finds
 * them by id like any other.
 */
export const CommandPoint = Point<Command>()(
  CORE_POINT_DEFINITIONS.command.name,
  CORE_POINT_DEFINITIONS.command.spec,
);

/** One row of the node menu: what to show, and what pressing it does. */
export interface NodeCommandListing {
  readonly id: string;
  /** The global command this row is the node's face of (`NodeCommand.faceOf`). */
  readonly faceOf?: string | undefined;
  readonly label: string;
  readonly icon: ReactNode;
  readonly run: () => void;
}

/**
 * Run `gesture`, the writes of a gesture about `rows`, as one write
 * (DESIGN-UI.md → Outline editor, "A selection is a range of rows"): over
 * several rows gathered by `PageWrites.together`; over one row as it is,
 * that row's write being one write already, so a write whose result the
 * gesture reads has landed when it reads it.
 */
export function asOneWrite<T>(rows: readonly string[], gesture: () => Promise<T>): Promise<T> {
  return rows.length > 1 ? browserHost().writes.together(gesture) : gesture();
}

/** A node command that acts on each row it is about (`target.nodeIds`), as one write (`asOneWrite`), and dismisses the menu. */
export function nodeAction(ctx: CommandContext, body: (nodeId: string) => unknown): void {
  const { nodeIds } = ctx.target;
  void asOneWrite(nodeIds, () => Promise.all(nodeIds.map((nodeId) => body(nodeId))));
  ctx.palette.close();
}

/** The core page's owner of the palette-step seam. */
export const paletteStepsPlugin = definePlugin({
  name: "ui",
  namespace: "ui",
  tags: ["core", "ui"],
  apply: (ctx) =>
    ctx.declare(PaletteStepPoint, CORE_POINT_DEFINITIONS.paletteStep.spec).pipe(Effect.asVoid),
});
