/**
 * The outline's own commands, contributed through `CommandPoint`: the
 * `sys.command` nodes "Expand all" and "Collapse all" open or close every
 * row under the zoom, which only the outline holds, and "Edit query" opens
 * a query node's builder from the node menu, the keyboard's way to what its
 * view control opens; "Show preview" / "Hide preview" opens or closes the
 * preview of a node whose tag opening draws one, the node menu's way to the
 * node's own toggle. The registry finds them by id like any other.
 */
import { EyeIcon, EyeSlashIcon, MagnifyingGlassIcon } from "@phosphor-icons/react";
import { queryTextOf } from "@kb/model";
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
import { previewShownOf, setPreviewShown } from "./row-opening";

/** The query the command's target row stores; null when it is no query node. */
const targetQuery = (ctx: CommandContext): string | null =>
  ctx.target.nodeId === null ? null : queryTextOf(ctx.outline.nodes.get(ctx.target.nodeId));

/** The command's target row's tag opening, when the page draws its preview; else null. */
function previewing(ctx: CommandContext): { opening: TagOpening; shown: boolean } | null {
  if (ctx.target.nodeId === null) return null;
  const byId = new Map(ctx.outline.wireNodes.map((n) => [n.id, n]));
  const node = byId.get(ctx.target.nodeId);
  const opening = tagOpeningOf(
    node,
    browserHost().viewCatalog(),
    currentContributions(ViewPoint),
    (id) => byId.get(id),
  );
  if (opening === null || opening.preview === null) return null;
  return { opening, shown: previewShownOf(node, opening.preview) };
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
  {
    id: "outline.preview",
    scope: "node",
    chrome: (ctx) => {
      const shown = previewing(ctx)?.shown === true;
      return {
        label: `${shown ? "Hide" : "Show"} preview: ${previewing(ctx)?.opening.key.label ?? ""}`,
        icon: shown ? <EyeSlashIcon size={14} /> : <EyeIcon size={14} />,
      };
    },
    when: (ctx) => previewing(ctx) !== null,
    run: (ctx) =>
      nodeAction(ctx, (nodeId) => setPreviewShown(nodeId, previewing(ctx)?.shown !== true)),
  },
];
