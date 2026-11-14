/**
 * Single owner of "which rows does this frame show, in what order".
 *
 * A frame is any node acting as a container: a parent, a frame laid out flat
 * by its view, or a query node presenting its results. Every frame view and
 * its host's keyboard walk resolve rows here, so rendered order and
 * navigable order cannot drift.
 *
 * Pure: pagination state is passed in as `pages`, never read from a store.
 */
import { daysOf } from "@kb/calendar-kit";
import {
  applyViewFilters,
  type BoardColumn,
  daySteps,
  flattenBoardOrder,
  groupChildrenForBoard,
  groupRowsByDay,
  groupSteps,
  type GroupSteps,
  shownGroups,
  sortChildrenForTable,
} from "./frame-layout.ts";
import type { FrameView } from "./frame-view";
import type { NodeMap, OutlineNode } from "./types";
import type { SchemaIndex } from "./schema";

export interface FrameRowsInput {
  frameId: string;
  /** The projection the rows come from. */
  nodes: NodeMap;
  /** What their fields mean: labels to filter, sort and group by. */
  schema: SchemaIndex;
  /** The view the frame shows its rows in, and the settings it reads (`frameViewOf`). */
  view: FrameView;
  /** Explicit row ids (query results) — overrides structural children. */
  rowIds?: readonly string[];
  /** Pages revealed in a paginating view (1 = first page). Default 1. */
  pages?: number;
  /** The day a calendar is open at (DESIGN-UI.md → Calendar); it shows no day without one. */
  day?: string;
}

export interface FrameRows {
  /** Filtered + sorted rows before pagination; board order is column-major, folded groups left out. */
  ordered: OutlineNode[];
  /** The groups the view shows, folded ones included, a calendar's days then its undated rows; empty for a view without groups. */
  columns: BoardColumn[];
  /** Field the columns are grouped by, a calendar's date field (null when the view declares none, or none is set). */
  groupFieldId: string | null;
  /**
   * Where each row moves by key, by row id (DESIGN-UI.md → Groups): empty
   * for a view without groups, and for a query's results, which do not move.
   */
  steps: ReadonlyMap<string, GroupSteps>;
  /** Rows actually rendered — pagination applied for a paginating view. */
  rendered: OutlineNode[];
  hasMore: boolean;
}

function nodesByIds(ids: readonly string[], nodes: NodeMap): OutlineNode[] {
  return ids.map((id) => nodes.get(id)).filter((n): n is OutlineNode => n !== undefined);
}

/** A frame's rows in groups, and where each moves by key; null for a view that does not group. */
interface Grouping {
  readonly columns: BoardColumn[];
  readonly groupFieldId: string | null;
  readonly steps: ReadonlyMap<string, GroupSteps>;
}

/**
 * How a view groups the frame's rows: a board's by its group field, a
 * calendar's by the days it shows around `day`. A query's results do not
 * move (DESIGN-UI.md → Groups).
 */
function groupingOf(
  view: FrameView,
  rows: OutlineNode[],
  schema: SchemaIndex,
  moves: boolean,
  day: string | undefined,
): Grouping | null {
  const { key, params } = view;
  if (key.rows === "calendar") {
    const groupFieldId = params.dateFieldId ?? null;
    const shown = day === undefined ? [] : daysOf(params.span ?? "month", day);
    const columns = groupRowsByDay(rows, groupFieldId, shown, schema);
    const stepped = moves && groupFieldId !== null && day !== undefined;
    return { columns, groupFieldId, steps: stepped ? daySteps(columns, shown, day) : new Map() };
  }
  if (key.rows !== "columns") return null;
  const groupFieldId = params.groupFieldId ?? null;
  const columns = shownGroups(groupChildrenForBoard(rows, groupFieldId, schema), {
    collapsed: params.collapsed ?? [],
    hideEmpty: params.hideEmpty ?? false,
  });
  const stepped = moves && groupFieldId !== null;
  return { columns, groupFieldId, steps: stepped ? groupSteps(columns) : new Map() };
}

/**
 * A frame's rows, as its view lays them out. What happens to them follows from
 * the settings the view's params declare, so nav and render agree by
 * construction: every view filters; a view sorts when it declares `sort`,
 * groups its columns by a field when it declares `groupFieldId` (folding and
 * dropping groups as its `collapsed` and `hideEmpty` say), groups them by day
 * when it lays out a `calendar`, and pages when it declares `pagesize`.
 */
export function frameRows({
  frameId,
  nodes,
  schema,
  view,
  rowIds,
  pages,
  day,
}: FrameRowsInput): FrameRows {
  const frame = nodes.get(frameId);
  const empty: FrameRows = {
    ordered: [],
    columns: [],
    groupFieldId: null,
    steps: new Map(),
    rendered: [],
    hasMore: false,
  };
  if (!frame && !rowIds) return empty;

  const { params } = view;
  const source = nodesByIds(rowIds ?? frame?.children ?? [], nodes);
  const filtered = applyViewFilters(source, params.filters, schema);
  const sorted = sortChildrenForTable(filtered, params.sort ?? [], schema);

  const grouping = groupingOf(view, sorted, schema, rowIds === undefined, day);
  const ordered = grouping === null ? sorted : flattenBoardOrder(grouping.columns);

  // Pages, not an absolute row count: a pagesize change re-derives the limit
  // instead of leaving a stale reveal count behind.
  const limit = params.pagesize === undefined ? null : params.pagesize * Math.max(1, pages ?? 1);
  const rendered = limit === null ? ordered : ordered.slice(0, limit);

  return {
    ordered,
    columns: grouping?.columns ?? [],
    groupFieldId: grouping?.groupFieldId ?? null,
    steps: grouping?.steps ?? new Map(),
    rendered,
    hasMore: limit !== null && ordered.length > limit,
  };
}
