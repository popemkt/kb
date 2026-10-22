/**
 * The outline's own commands, contributed through `CommandPoint`: the
 * `sys.command` nodes "Expand all" and "Collapse all" open or close every
 * row under the zoom, which only the outline holds, and "Edit query" opens
 * a query node's builder from the node menu, the keyboard's way to what its
 * view control opens. The registry finds them by id like any other.
 */
import { MagnifyingGlassIcon } from "@phosphor-icons/react";
import { queryTextOf } from "@kb/model";
import { nodeAction, SYSTEM_IDS, type Command, type CommandContext } from "@kb/ui-sdk";
import { outlineNodes, useOutlineStore } from "./outline.store";
import { queryBuilderOpen, setQueryBuilderOpen } from "./query-builder/open";

/** The query the command's target row stores; null when it is no query node. */
const targetQuery = (ctx: CommandContext): string | null =>
  ctx.target.nodeId === null ? null : queryTextOf(ctx.outline.nodes.get(ctx.target.nodeId));

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
];
