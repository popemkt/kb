/**
 * Live results under an expanded query node (DESIGN-REFINE §2 W4), below
 * its builder (`QueryPanel`: the Conditions and EDN tabs and the count)
 * while that is open; the results are the node's content, and the builder
 * is tucked behind the node's view control (`query-builder/open.ts`).
 * The list view → NodeBlock refs, continuing the list. Any other view → the
 * frame's view in a slot, over the results, with query-result instance keys
 * (W7.1 / W8e).
 *
 * The results and the count are one read of one answer (`useQueryRows`):
 * the count is how many distinct result nodes the answer names, before the
 * node's limit, and a run over its budget is counted as nothing. The
 * builder can be opened on every query node, one whose EDN is empty (a
 * query being written) included; only a definition (`queryDefOf`) runs.
 */
import type { ReactNode } from "react";
import {
  hasText,
  indentStyle,
  queryResultInstanceKey,
  resultNodeIds,
  useGraphRead,
  useQueryRows,
} from "@kb/ui-sdk";
import { queryDefOf, queryTextOf } from "@kb/model";
import { projectsRows, type FrameViewKey } from "@kb/views";
import { useOutlineNode, useOutlineNodes } from "./outline.store";
import { FrameViewSlot } from "./frame-view-slot";
import { QueryPanel } from "./query-builder/query-panel";
import { setQueryBuilderOpen, useQueryBuilderOpen } from "./query-builder/open";
import type { QueryCount } from "./query-builder/count-chip";

/** What a query node with no EDN yet answers: nothing runs. */
const EMPTY_QUERY = "The query is empty: there is nothing to run.";

interface QueryResultItem {
  nodeId: string;
  instanceKey: string;
  depth: number;
}

interface QueryResultsSectionProps {
  nodeId: string;
  depth: number;
  /** The view the query node shows its results in; null while none is provided. */
  view: FrameViewKey | null;
  frameInstanceKey?: string;
  /** How to render one result node. Inverted from QueryResultsSection so the
   * recursive node <-> query-results pair is not a static import cycle. */
  renderNode: (item: QueryResultItem) => ReactNode;
}

export function QueryResultsSection({
  nodeId,
  depth,
  view,
  frameInstanceKey,
  renderNode,
}: QueryResultsSectionProps) {
  const node = useOutlineNode(nodeId);
  const nodes = useOutlineNodes();
  const read = useGraphRead();
  // The builder is the node's query field's, whatever it holds; only a
  // definition runs, so a query emptied keeps the editor that writes it.
  const text = queryTextOf(node);
  const def = queryDefOf(node);
  const answer = useQueryRows(def?.edn ?? null);
  const open = useQueryBuilderOpen(nodeId, text);

  if (text === null) return null;

  const { rows, overBudget } = answer;
  const error = def === null ? EMPTY_QUERY : answer.error;

  const all = rows === null ? null : resultNodeIds(rows, nodes, { excludeId: nodeId });
  const ids = all === null ? [] : all.slice(0, def?.limit ?? undefined);
  const count: QueryCount =
    all !== null
      ? { t: "nodes", n: all.length }
      : overBudget
        ? { t: "over-budget" }
        : hasText(error)
          ? { t: "failed" }
          : { t: "pending" };

  const indent = indentStyle(depth + 1);
  const panel = open ? (
    <QueryPanel nodeId={nodeId} edn={text} count={count} depth={depth} read={read} />
  ) : null;

  if (hasText(error)) {
    return (
      <div className="query-results" data-query-results-for={nodeId}>
        {panel}
        <p className="px-1 py-0.5 text-meta text-destructive" style={indent}>
          {error}
          {/* A query that fails is the one most in need of its editor: the
              error is the way to it while the builder is tucked away. */}
          {!open && (
            <button
              type="button"
              className="ml-2 rounded-xs text-foreground/60 underline underline-offset-2 hover:text-foreground"
              data-query-edit-from-error={nodeId}
              onClick={(e) => {
                e.stopPropagation();
                setQueryBuilderOpen(nodeId, true);
              }}
            >
              Edit query
            </button>
          )}
        </p>
      </div>
    );
  }

  if (rows === null) {
    return (
      <div className="query-results" data-query-results-for={nodeId} aria-busy="true">
        {panel}
        <p className="px-1 py-0.5 text-meta text-foreground/50" style={indent} aria-live="polite">
          Loading results…
        </p>
      </div>
    );
  }

  if (projectsRows(view)) {
    return (
      <div className="query-results" data-query-results-for={nodeId}>
        {panel}
        <div style={indent}>
          {ids.length === 0 ? (
            <p className="px-1 py-0.5 text-meta text-foreground/50">No results yet</p>
          ) : (
            <FrameViewSlot
              frameId={nodeId}
              instanceKey={frameInstanceKey}
              rowIds={ids}
              isQuerySource
              depth={depth + 1}
            />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="query-results" data-query-results-for={nodeId}>
      {panel}
      {ids.length === 0 ? (
        <p className="px-1 py-0.5 text-meta text-foreground/50" style={indent}>
          No results
        </p>
      ) : (
        ids.map((id) => {
          const key = queryResultInstanceKey(nodeId, id);
          return renderNode({
            nodeId: id,
            instanceKey: key,
            depth: depth + 1,
          });
        })
      )}
    </div>
  );
}
