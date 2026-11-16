/**
 * The projection from nodes to the outline tree (DESIGN.md → Outline
 * formats, "The projection"): the one way nodes become the tree an export
 * writes. Pure and isomorphic; it walks the graph, never a screen, so a
 * collapsed row's children are written.
 */
import {
  SYSTEM_IDS,
  chipTagsOf,
  fieldShowOf,
  nodeName,
  nodeTitleOf,
  pinnedFirst,
  selectionRoots,
  shownWalk,
  typeRefsOf,
  valueSource,
  type NodeId,
  type NodeLike,
  type ShownRow,
} from "@kb/model";
import type { OutlineItem } from "./outline.ts";

/** What the projection reads of the graph: a node by id, and its parent. */
export interface OutlineGraph {
  readonly nodeOf: (id: NodeId) => NodeLike | undefined;
  readonly parentOf: (id: NodeId) => NodeId | null | undefined;
}

export interface ProjectOptions {
  /** Each top row with every node under it, or each row alone. */
  readonly children: boolean;
  /** Tags and fields written, or only text and children. */
  readonly fieldsAndTags: boolean;
  /** What a person reads (`labels`), or each node as stored, everything by id (`ids`). */
  readonly names: "labels" | "ids";
}

/** One item's parts, before its line in tree order is known. */
type Parts = Pick<OutlineItem, "text" | "tags" | "fields">;

/** A node's name where a person reads it, its id when it has none. */
const named = (id: NodeId, nodeOf: OutlineGraph["nodeOf"]): string => nodeName(id, nodeOf) || id;

/** The fields a node holds, in their order, less its kinds (`sys.f.type`, written as tags). */
function heldFields(node: NodeLike): [NodeId, NodeLike["props"][string]][] {
  return Object.entries(node.props).filter(
    ([field, values]) => field !== SYSTEM_IDS.typeField && values.length > 0,
  );
}

/** What a person reads of a row: the node it shows, its title, its chips and the fields it draws. */
function reading({ shown }: ShownRow<NodeLike>, nodes: OutlineGraph, withMarks: boolean): Parts {
  const { nodeOf } = nodes;
  const text = nodeTitleOf(shown.id, shown, nodeOf);
  if (!withMarks) return { text, tags: [], fields: [] };
  const drawn = heldFields(shown).filter(
    ([field]) => fieldShowOf(nodeOf(field)?.props) !== "never",
  );
  return {
    text,
    tags: chipTagsOf(shown, nodeOf).map((tag) => named(tag, nodeOf)),
    fields: pinnedFirst(drawn, ([field]) => field, nodeOf).map(([field, values]) => ({
      line: 0,
      name: named(field, nodeOf),
      values: values.map((value) => ({ line: 0, raw: valueSource(value) })),
    })),
  };
}

/** A row as stored: its own text, every kind it declares, every field it holds, all by id. */
function source({ row }: ShownRow<NodeLike>, withMarks: boolean): Parts {
  if (!withMarks) return { text: row.text, tags: [], fields: [] };
  return {
    text: row.text,
    tags: typeRefsOf(row),
    fields: heldFields(row).map(([field, values]) => ({
      line: 0,
      name: field,
      values: values.map((value) => ({ line: 0, raw: valueSource(value) })),
    })),
  };
}

/**
 * The tree `rows` make. With children, the top rows (`selectionRoots`), each
 * with every row under it as `shownWalk` meets them; without, each row
 * alone, in order. Each item is the row's reading (`labels`) or its source
 * (`ids`); its line is its place in tree order, from 1.
 */
export function outlineOfNodes(
  rows: readonly NodeId[],
  nodes: OutlineGraph,
  options: ProjectOptions,
): OutlineItem[] {
  const walked = options.children
    ? shownWalk(selectionRoots(rows, nodes.parentOf), nodes.nodeOf)
    : rows.flatMap((id) =>
        shownWalk([id], (at) => {
          const node = nodes.nodeOf(at);
          return node === undefined || at !== id ? node : { ...node, children: [] };
        }),
      );
  let line = 0;
  const toItem = (row: ShownRow<NodeLike>): OutlineItem => {
    line += 1;
    const at = line;
    const parts =
      options.names === "ids"
        ? source(row, options.fieldsAndTags)
        : reading(row, nodes, options.fieldsAndTags);
    return {
      line: at,
      ...parts,
      fields: parts.fields.map((field) => ({
        ...field,
        line: at,
        values: field.values.map((value) => ({ ...value, line: at })),
      })),
      children: row.children.map(toItem),
    };
  };
  return walked.map(toItem);
}
