/**
 * The outline's own commands, contributed through `CommandPoint`: the
 * `sys.command` nodes "Expand all" and "Collapse all" open or close every
 * row under the zoom, which only the outline holds, and "Edit query" opens
 * a query node's builder from the node menu, the keyboard's way to what its
 * view control opens; and for a node a tag opens in a view, "Show …" /
 * "Hide …" for each display option its opening offers (the preview, the
 * properties), the node's own toggle of it, leading the menu after "Open
 * in …". The registry finds them by id like any other.
 */
import {
  EyeSlashIcon,
  ListBulletsIcon,
  MagnifyingGlassIcon,
  RowsIcon,
} from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { DISPLAY_OPTIONS, queryTextOf, type DisplayOption } from "@kb/model";
import {
  browserHost,
  currentContributions,
  nodeAction,
  SYSTEM_IDS,
  tagOpeningOf,
  ViewPoint,
  type Command,
  type CommandContext,
  type TagOpening,
} from "@kb/ui-sdk";
import { outlineNodes, useOutlineStore } from "./outline.store";
import { queryBuilderOpen, setQueryBuilderOpen } from "./query-builder/open";
import { displayShownOf, setDisplayShown } from "./row-opening";

/** The query the command's target row stores; null when it is no query node. */
const targetQuery = (ctx: CommandContext): string | null =>
  ctx.target.nodeId === null ? null : queryTextOf(ctx.outline.nodes.get(ctx.target.nodeId));

/**
 * Whether `option` is on for the command's target row, when its tag opening
 * offers the option; else null.
 */
function displaying(ctx: CommandContext, option: DisplayOption): boolean | null {
  if (ctx.target.nodeId === null) return null;
  const byId = new Map(ctx.outline.wireNodes.map((n) => [n.id, n]));
  const node = byId.get(ctx.target.nodeId);
  const opening: TagOpening | null = tagOpeningOf(
    node,
    browserHost().viewCatalog(),
    currentContributions(ViewPoint),
    (id) => byId.get(id),
  );
  if (opening === null || !opening.options.includes(option)) return null;
  return displayShownOf(node, opening, option);
}

const DISPLAY_CHROME: Readonly<Record<DisplayOption, { label: string; icon: ReactNode }>> = {
  preview: { label: "preview", icon: <RowsIcon size={14} /> },
  properties: { label: "properties", icon: <ListBulletsIcon size={14} /> },
};

/** "Show …" / "Hide …" for `option`: the node's own toggle of it. */
function displayCommand(option: DisplayOption): Command {
  return {
    id: `outline.display.${option}`,
    scope: "node",
    leads: true,
    chrome: (ctx) => {
      const shown = displaying(ctx, option) === true;
      return {
        label: `${shown ? "Hide" : "Show"} ${DISPLAY_CHROME[option].label}`,
        icon: shown ? <EyeSlashIcon size={14} /> : DISPLAY_CHROME[option].icon,
      };
    },
    when: (ctx) => displaying(ctx, option) !== null,
    run: (ctx) =>
      nodeAction(ctx, (nodeId) =>
        setDisplayShown(nodeId, option, displaying(ctx, option) !== true),
      ),
  };
}

export const OUTLINE_COMMANDS: readonly Command[] = [
  {
    id: SYSTEM_IDS.cmdExpandAll,
    scope: "global",
    run: () => useOutlineStore.getState().expandAllInScope(),
  },
  {
    id: SYSTEM_IDS.cmdCollapseAll,
    scope: "global",
    run: () => useOutlineStore.getState().collapseAllInScope(),
  },
  {
    id: "outline.query-builder",
    scope: "node",
    chrome: (ctx) => ({
      label:
        ctx.target.nodeId !== null && queryBuilderOpen(ctx.target.nodeId, targetQuery(ctx))
          ? "Hide query"
          : "Edit query",
      icon: <MagnifyingGlassIcon size={14} weight="bold" />,
    }),
    when: (ctx) => targetQuery(ctx) !== null,
    run: (ctx) =>
      nodeAction(ctx, (nodeId) => {
        const open = !queryBuilderOpen(nodeId, targetQuery(ctx));
        setQueryBuilderOpen(nodeId, open);
        // The builder is drawn under the row: a closed row is opened to show it.
        if (open && outlineNodes().get(nodeId)?.collapsed === true) {
          useOutlineStore.getState().toggleCollapse(nodeId);
        }
      }),
  },
  ...DISPLAY_OPTIONS.map(displayCommand),
];
