/**
 * What a row shows, as one value.
 *
 * `NodeBlock` derived `hasFields`, `showsQueryResults`, `showsChildren`,
 * `hasFrameRows`, `isExpandable`, `showToolbar`, `projected` and `bulletIsRef`
 * in its own body and then branched on all eight inside its JSX, so a
 * view-mode change was a hunt through a component rather than one edit. The
 * rules live here; the component renders what it is handed.
 *
 * The flags are not independent, and the dependencies are the point:
 * "expandable" must not promise more than the render gates deliver, which is
 * why it is derived from them rather than asked separately.
 */
import { isQueryNode } from "@kb/model";
import { projectsRows, type FrameViewKey } from "@kb/views";
import { isContextualRef, shownNode, showsAncestor } from "./contextual-ref";
import { isProjectedRow } from "./instance-key";
import { resolveProps } from "./graph-view";
import type { OutlineNode } from "./types";
import type { SchemaIndex } from "./schema";

/** What a row draws under it: its query's results, or its children and the strip that adds one. */
export interface RowRows {
  showsQueryResults: boolean;
  showsChildren: boolean;
  /** Whether this row offers the whitespace-create strip under its children. */
  showsCreateChild: boolean;
}

export interface RowChrome extends RowRows {
  /**
   * A contextual reference row IS a reference, so it takes the dashed ref ring
   * the outline already uses for projected rows. It is only the *bullet*
   * that is shared: a projected row's place is computed rather than a child
   * edge, which suppresses nested results and the create-child strip. A
   * contextual reference is a real child with children of its own, so those
   * gates keep reading `projectedRow`, not this.
   */
  bulletIsRef: boolean;
  hasFields: boolean;
  /** Children or query results — the rows a frame's chrome belongs to. */
  hasFrameRows: boolean;
  /** What the bullet's toggle affordance promises. */
  isExpandable: boolean;
  /**
   * Tana model: the frame's settings sit beside it while it is expanded, when
   * there is something to set — a view other than the list, or a query.
   */
  showToolbar: boolean;
  /** The view renders a flat projection, so rows are the projection's business. */
  projected: boolean;
  /** The guide-line strip and everything under the row. */
  showsChildContainer: boolean;
}

/**
 * The row stands for a node whose place or text lives elsewhere — a
 * projected row, or a contextual reference — and so wears the dashed ref ring. One
 * answer for every surface that draws a row (list, table, card).
 */
export function isReferenceRow(node: OutlineNode, projectedRow: boolean): boolean {
  return projectedRow || isContextualRef(node);
}

export interface RowChromeInput {
  /** The row's node — for a contextual reference, the reference itself. */
  node: OutlineNode;
  /** Where field definitions are read from: the whole graph (`lib/schema.ts`). */
  schema: SchemaIndex;
  /** The view the children of the node the row shows are shown in. */
  view: FrameViewKey | null;
  /**
   * This render instance. Whether the row is a projected row
   * (`isProjectedRow`) and whether it repeats a row above it
   * (`showsAncestor`) are read from it.
   */
  instanceKey: string;
  showDebugFields: boolean;
  /** Hidden fields the row's display draws anyway (`ResolvePropsOptions.revealed`). */
  revealed?: ReadonlySet<string> | undefined;
}

/**
 * The rows a row draws under it, wherever it is drawn (a list's row, a lane's
 * head; `RowChildren`): a query's results, unless the row is itself a
 * projected row or repeats one above it; else its shown node's children; and
 * the strip that adds a child, unless its place is computed (a projected row)
 * or its rows are a projection's business.
 */
export function resolveRowRows({
  node,
  schema,
  view,
  instanceKey,
}: Pick<RowChromeInput, "node" | "schema" | "view" | "instanceKey">): RowRows {
  const shown = shownNode(node, schema);
  const projectedRow = isProjectedRow(instanceKey);
  // A row that repeats one above it draws no rows under it (`showsAncestor`).
  const repeats = showsAncestor(instanceKey, node, schema);
  const isQuery = isQueryNode(shown);
  return {
    // A query node projects results instead of children, and a projected row
    // does not re-run a nested query.
    showsQueryResults: isQuery && !projectedRow && !repeats,
    showsChildren: !isQuery && shown.children.length > 0 && !repeats,
    showsCreateChild: !projectedRow && !projectsRows(view),
  };
}

/**
 * What the row draws is its shown node's (`shownNode`): children, query,
 * fields. Whether it is open is the row's own (`node.collapsed`), and so is
 * the reference ring.
 */
export function resolveRowChrome({
  node,
  schema,
  view,
  instanceKey,
  showDebugFields,
  revealed,
}: RowChromeInput): RowChrome {
  const rows = resolveRowRows({ node, schema, view, instanceKey });
  const hasFrameRows = rows.showsChildren || rows.showsQueryResults;
  const hasFields =
    resolveProps(shownNode(node, schema), schema, { showDebugFields, revealed }).length > 0;
  const isExpandable = hasFrameRows || hasFields;
  const projected = projectsRows(view);

  return {
    ...rows,
    bulletIsRef: isReferenceRow(node, isProjectedRow(instanceKey)),
    hasFields,
    hasFrameRows,
    isExpandable,
    showToolbar: hasFrameRows && !node.collapsed && (projected || rows.showsQueryResults),
    projected,
    showsChildContainer: isExpandable && !node.collapsed,
  };
}
