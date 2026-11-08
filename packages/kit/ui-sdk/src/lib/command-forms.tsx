/**
 * A node command and a picker step written as data, their T0 forms
 * (DESIGN-UI.md → The node menu): a label, an icon by name, where the menu
 * lists it, saved queries for when it is offered and what it offers, and
 * an action to call. The page runs the picker, reads the queries and makes
 * the call, so an extension that contributes them runs none of its own
 * code when a person picks.
 */
import type { ReactNode } from "react";
import {
  ArrowRightIcon,
  BellIcon,
  BookmarkSimpleIcon,
  CalendarBlankIcon,
  CheckIcon,
  FlagIcon,
  FolderIcon,
  HashIcon,
  LinkSimpleIcon,
  MagnifyingGlassIcon,
  NoteIcon,
  PencilSimpleIcon,
  PlusIcon,
  PushPinIcon,
  SparkleIcon,
  StarIcon,
  TagIcon,
  UserIcon,
  type Icon,
} from "@phosphor-icons/react";
import type { ContributionEntry } from "@kb/plugin";
import { callInput, invokeAction, type ActionCall } from "./action-call";
import {
  NODE_MENU_GROUPS,
  nodeAction,
  nodeMenu,
  type Command,
  type CommandContext,
  type NodeCommand,
  type NodeMenuGroup,
  type PaletteStep,
} from "./command-point";
import type { PickerCandidate } from "./picker";
import { savedQueryIds } from "./saved-query";

/** The icons a form names, by name. */
const FORM_ICONS = {
  "arrow-right": ArrowRightIcon,
  bell: BellIcon,
  bookmark: BookmarkSimpleIcon,
  calendar: CalendarBlankIcon,
  check: CheckIcon,
  flag: FlagIcon,
  folder: FolderIcon,
  hash: HashIcon,
  link: LinkSimpleIcon,
  "magnifying-glass": MagnifyingGlassIcon,
  note: NoteIcon,
  pencil: PencilSimpleIcon,
  plus: PlusIcon,
  pin: PushPinIcon,
  sparkle: SparkleIcon,
  star: StarIcon,
  tag: TagIcon,
  user: UserIcon,
} as const satisfies Record<string, Icon>;

/** An icon a form names: one of the shell's, drawn as the shell draws its own. */
export type IconName = keyof typeof FORM_ICONS;

/** The icon `name` names, checked where the form is provided. */
function iconOf(owner: string, name: IconName | undefined): Icon | null {
  if (name === undefined) return null;
  const icon: Icon | undefined = (FORM_ICONS as Readonly<Record<string, Icon>>)[name];
  if (icon === undefined) throw new Error(`${owner}: "${name}" is no icon kb names`);
  return icon;
}

function drawn(icon: Icon | null, size: number): ReactNode {
  if (icon === null) return null;
  const Glyph = icon;
  return <Glyph size={size} weight="bold" />;
}

/** A node command as data. */
export interface CommandForm {
  readonly label: string;
  readonly icon?: IconName;
  /** Where the node menu lists it: its group, then `order` in it (lower first). */
  readonly group: NodeMenuGroup;
  readonly order: number;
  /**
   * A query node, by id: the command is offered on the rows whose id is in
   * its answer's first column. Absent, on every row.
   */
  readonly when?: string;
  /** An action about the row, or the picker step to open, by its contribution's id. */
  readonly run: ActionCall | { readonly step: string };
}

/** Whether the command's row is one `queryId` answers now. */
function answered(queryId: string, ctx: CommandContext): boolean {
  const nodeId = ctx.target.nodeId;
  return nodeId !== null && (savedQueryIds(queryId)?.has(nodeId) ?? false);
}

/**
 * The {@link CommandPoint} contribution for a node command written as
 * data. A group that is not the menu's, or an icon kb does not name,
 * throws where its plugin applies, as a malformed contribution should.
 */
export function provideCommand(id: string, form: CommandForm): ContributionEntry<Command> {
  if (!(NODE_MENU_GROUPS as readonly string[]).includes(form.group)) {
    throw new Error(`command ${id}: "${form.group}" is no group of the node menu`);
  }
  const icon = iconOf(`command ${id}`, form.icon);
  const { run, when } = form;
  const command: NodeCommand = {
    id,
    menu: nodeMenu(form.group, form.order),
    chrome: () => ({ label: form.label, icon: drawn(icon, 14) }),
    ...(when === undefined ? {} : { when: (ctx: CommandContext) => answered(when, ctx) }),
    run: (ctx) => {
      if ("step" in run) {
        ctx.palette.openStep(run.step);
        return;
      }
      nodeAction(
        ctx,
        (nodeId) => void invokeAction({ ...run, input: callInput(run, { id: nodeId }) }),
      );
    },
  };
  return { id, value: command };
}

/** A picker step as data. */
export interface PaletteStepForm {
  readonly label: string;
  readonly placeholder: string;
  readonly icon?: IconName;
  /** A query node, by id: the nodes in its answer's first column are the candidates. */
  readonly candidates: string;
  /** At most this many rows; absent, every match. */
  readonly limit?: number;
  /** The action the pick calls, about the row; the pick fills each `PICKED` in its input. */
  readonly commit: ActionCall;
}

/**
 * The {@link PaletteStepPoint} contribution for a picker step written as
 * data. The row the palette is anchored to is never its own candidate, a
 * candidate is named by its text, and nothing can be minted from the
 * picker.
 */
export function providePaletteStep(
  id: string,
  form: PaletteStepForm,
): ContributionEntry<PaletteStep> {
  const icon = iconOf(`palette step ${id}`, form.icon);
  const { commit } = form;
  const step: PaletteStep = {
    label: form.label,
    placeholder: form.placeholder,
    icon: drawn(icon, 12),
    candidates: (graph) =>
      [...(savedQueryIds(form.candidates) ?? [])]
        .flatMap((nodeId): PickerCandidate[] => {
          const node = graph.nodes.get(nodeId);
          if (node === undefined || nodeId === graph.anchorId) return [];
          return [{ id: nodeId, label: node.text.trim() || nodeId }];
        })
        .toSorted((a, b) => a.label.localeCompare(b.label)),
    ...(form.limit === undefined ? {} : { limit: form.limit }),
    commit: ({ targetNodeId, pickedId }) =>
      invokeAction({ ...commit, input: callInput(commit, { id: targetNodeId, picked: pickedId }) }),
  };
  return { id, value: step };
}
