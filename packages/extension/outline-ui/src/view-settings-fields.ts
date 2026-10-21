/**
 * What the view settings popover offers, as data: the fields a frame's rows
 * may be filtered, grouped and shown by, its current columns, and the page
 * sizes it offers. Lives outside the popover component so the popover file
 * exports components only, and so each answer is a function of the graph.
 */
import { typeRefsOf } from "@kb/model";
import {
  SYSTEM_IDS,
  isFieldHidden,
  isSysPrefixed,
  resolveTableColumns,
  type NodeMap,
  type OutlineNode,
  type PickerCandidate,
  type SchemaIndex,
  type TableColumnSpec,
} from "@kb/ui-sdk";
import type { ViewConfig } from "@kb/views";

/** The frame's rows, as the projection `nodes` holds them. */
function frameRowNodes(frame: OutlineNode, nodes: NodeMap): OutlineNode[] {
  return frame.children.map((id) => nodes.get(id)).filter((n): n is OutlineNode => n !== undefined);
}

/**
 * The columns a frame's rows are shown with now: those its view node names,
 * or, naming none, those the rows' tags template (`resolveTableColumns`).
 */
export function frameColumns(
  frameId: string,
  nodes: NodeMap,
  schema: SchemaIndex,
  config: Pick<ViewConfig, "display">,
): TableColumnSpec[] {
  const frame = nodes.get(frameId);
  if (!frame) return [];
  return resolveTableColumns(config, frameRowNodes(frame, nodes), schema);
}

/**
 * The fields a frame's rows may be filtered, grouped or shown by, one list
 * for every section of the popover, in the order a
 * person reaches for them: those the rows' tags template first, then every
 * other field a person made. A field its node hides is offered by neither,
 * as it has no row on the page (`isFieldHidden`); a system field is offered
 * only where a row's tag templates it, as the query builder offers fields.
 */
export function frameFieldCandidates(
  frameId: string,
  nodes: NodeMap,
  schema: SchemaIndex,
): PickerCandidate[] {
  const frame = nodes.get(frameId);
  if (!frame) return [];
  const templated = resolveTableColumns({ display: [] }, frameRowNodes(frame, nodes), schema).map(
    (c) => ({ id: c.fieldId, label: c.label }),
  );
  const seen = new Set(templated.map((c) => c.id));
  const others: PickerCandidate[] = [];
  for (const node of schema.values()) {
    if (seen.has(node.id) || isSysPrefixed(node.id)) continue;
    if (!typeRefsOf(node).includes(SYSTEM_IDS.field)) continue;
    if (isFieldHidden(node.id, schema)) continue;
    others.push({ id: node.id, label: node.text === "" ? node.id : node.text });
  }
  return [...templated, ...others.toSorted((a, b) => a.label.localeCompare(b.label))];
}

/** The page sizes offered, with the one a view node holds when it is none of them. */
export function pageSizeOptions(current: number): number[] {
  const offered = [10, 25, 50, 100, 250, 500];
  return offered.includes(current) ? offered : [...offered, current].toSorted((a, b) => a - b);
}
