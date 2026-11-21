/**
 * Pure layout position assigners for non-force modes.
 * `force` is handled by the FA2 worker; these skip it entirely (r10 §2 row 8).
 */
import type { LensNode } from "./graph-lens";
import type { LensEdge, LensLayout } from "@kb/graph";

export type LayoutPoint = { x: number; y: number };

/** How far apart two neighbouring nodes must stand, centre to centre (none by default). */
export type LayoutSpacing = (a: LensNode, b: LensNode) => number;
const NO_SPACING: LayoutSpacing = () => 0;

/**
 * Where a placed layout puts each node: spread over a box of `size`, and
 * never closer to the next node along its ring, column or row than `spacing`
 * says — the ring, the column or the cell grows to hold them.
 */
export function computeLayoutPositions(
  layout: LensLayout,
  nodes: LensNode[],
  edges: LensEdge[],
  size: { width: number; height: number } = { width: 800, height: 600 },
  spacing: LayoutSpacing = NO_SPACING,
): Map<string, LayoutPoint> | null {
  if (layout === "force") return null;
  if (layout === "radial") return radialLayout(nodes, size, spacing);
  if (layout === "hierarchical") return hierarchicalLayout(nodes, edges, size, spacing);
  return gridLayout(nodes, size, spacing);
}

/** Each node's offset along a line: evenly `step` apart, or further where `spacing` asks. */
function along(line: readonly LensNode[], step: number, spacing: LayoutSpacing): number[] {
  const out: number[] = [];
  let at = 0;
  line.forEach((node, i) => {
    const previous = line[i - 1];
    if (previous !== undefined) at += Math.max(step, spacing(previous, node));
    out.push(at);
  });
  return out;
}

/** The spacing the largest node asks of its own kind: a column's or a cell's least width. */
function widest(nodes: readonly LensNode[], spacing: LayoutSpacing): number {
  return nodes.reduce((most, node) => Math.max(most, spacing(node, node)), 0);
}

/** Ring anchors sorted by id for determinism. */
export function radialLayout(
  nodes: LensNode[],
  size: { width: number; height: number },
  spacing: LayoutSpacing = NO_SPACING,
): Map<string, LayoutPoint> {
  const out = new Map<string, LayoutPoint>();
  const sorted = [...nodes].toSorted((a, b) => a.id.localeCompare(b.id));
  const n = sorted.length;
  const cx = size.width / 2;
  const cy = size.height / 2;
  if (n === 0) return out;
  // The ring's length: every neighbour's spacing, the last back round to the first.
  const first = sorted[0];
  const last = sorted[n - 1];
  const offsets = along(sorted, 0, spacing);
  const closing = first !== undefined && last !== undefined ? spacing(last, first) : 0;
  const length = (offsets[n - 1] ?? 0) + closing;
  const R = Math.max(Math.min(size.width, size.height) * 0.38, length / (2 * Math.PI));
  const [only] = sorted;
  if (n === 1 && only !== undefined) {
    out.set(only.id, { x: cx, y: cy });
    return out;
  }
  sorted.forEach((node, i) => {
    const share = length > 0 ? (offsets[i] ?? 0) / length : i / n;
    const angle = 2 * Math.PI * share - Math.PI / 2;
    out.set(node.id, {
      x: cx + Math.cos(angle) * R,
      y: cy + Math.sin(angle) * R,
    });
  });
  return out;
}

/**
 * The layers of a hierarchy: each node at its shortest depth from the roots,
 * walked breadth-first. The roots are the nodes no edge enters, or the first
 * id when every node has one (a cycle); a node already layered is never
 * walked again, so a cycle ends the walk, and a node no root reaches stands
 * in the first layer. Edges off the node set are ignored. Layers are keyed by
 * depth, each sorted by id.
 *
 * This is not the tree's spanning forest (`buildTreeForest`): a tree puts a
 * node under the first parent it is walked from, depth-first, while a layer
 * is the shortest distance, so a shortcut edge pulls its target forward.
 */
export function depthLayers(
  nodes: readonly LensNode[],
  edges: readonly LensEdge[],
): ReadonlyMap<number, readonly string[]> {
  const ids = nodes.map((n) => n.id).toSorted();
  const children = new Map<string, string[]>(ids.map((id) => [id, []]));
  const entered = new Set<string>();
  for (const e of edges) {
    if (!children.has(e.source) || !children.has(e.target)) continue;
    children.get(e.source)?.push(e.target);
    entered.add(e.target);
  }
  for (const [, kids] of children) kids.sort();

  const unentered = ids.filter((id) => !entered.has(id));
  const roots = unentered.length > 0 ? unentered : ids.slice(0, 1);
  const depth = new Map<string, number>(roots.map((r) => [r, 0]));
  const queue = [...roots];
  for (let cur = queue.shift(); cur !== undefined; cur = queue.shift()) {
    const d = depth.get(cur) ?? 0;
    for (const kid of children.get(cur) ?? []) {
      if (depth.has(kid)) continue;
      depth.set(kid, d + 1);
      queue.push(kid);
    }
  }

  const layers = new Map<number, string[]>();
  for (const id of ids) {
    const d = depth.get(id) ?? 0;
    const list = layers.get(d) ?? [];
    list.push(id);
    layers.set(d, list);
  }
  return layers;
}

/**
 * Layer columns by depth (`depthLayers`): one column per layer, left to
 * right, its nodes spread down it. Deterministic within a fixture.
 */
export function hierarchicalLayout(
  nodes: LensNode[],
  edges: LensEdge[],
  size: { width: number; height: number },
  spacing: LayoutSpacing = NO_SPACING,
): Map<string, LayoutPoint> {
  const out = new Map<string, LayoutPoint>();
  const layers = depthLayers(nodes, edges);
  const maxDepth = Math.max(0, ...layers.keys());
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const colGap = Math.max(size.width / (maxDepth + 2), widest(nodes, spacing));
  for (const [d, layer] of layers) {
    const rowGap = size.height / (layer.length + 1);
    const column = layer.flatMap((id) => byId.get(id) ?? []);
    const offsets = along(column, rowGap, spacing);
    column.forEach((node, i) => {
      out.set(node.id, {
        x: colGap * (d + 1),
        y: rowGap + (offsets[i] ?? 0),
      });
    });
  }
  return out;
}

/** Cell grid sorted by id. */
export function gridLayout(
  nodes: LensNode[],
  size: { width: number; height: number },
  spacing: LayoutSpacing = NO_SPACING,
): Map<string, LayoutPoint> {
  const out = new Map<string, LayoutPoint>();
  const sorted = [...nodes].toSorted((a, b) => a.id.localeCompare(b.id));
  const n = sorted.length;
  if (n === 0) return out;
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  const cell = widest(nodes, spacing);
  const cellW = Math.max(size.width / (cols + 1), cell);
  const cellH = Math.max(size.height / (rows + 1), cell);
  sorted.forEach((node, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    out.set(node.id, {
      x: cellW * (col + 1),
      y: cellH * (row + 1),
    });
  });
  return out;
}
