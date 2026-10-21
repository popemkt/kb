/**
 * A node's neighbourhood as a lens graph: the graph page's extraction
 * (`extractLensGraph`) over the node set within N hops of a root. DESIGN.md →
 * Kinds, roles and options → View nodes states what a neighbourhood is.
 */
import type { WireNode } from "@kb/contracts";
import { queryNeighbourhood, type EdnRunner } from "@kb/ui-sdk";
import { extractLensGraph, type GraphLens, lensConfig } from "./graph-lens";
import type { EdgeKind, LensPerspective } from "@kb/graph";

/**
 * The node-valued attribute a neighbourhood walks for an edge kind. Text
 * references and reference fields are one relation in the datoms
 * (`:node/mentions`), so either reaches the other's neighbours; the edges
 * drawn between them keep their kinds apart (`collectEdges`).
 */
function reachAttribute(kind: EdgeKind): string {
  if (kind === "child") return ":node/child";
  if (kind.startsWith("prop:")) return `:f/${kind.slice("prop:".length)}`;
  return ":node/mentions";
}

/** Where a neighbourhood starts, how far it reaches, and along which edges. */
export interface NeighbourhoodSpec {
  readonly root: string;
  readonly hops: number;
  readonly edges: readonly EdgeKind[];
}

/**
 * `root` and the nodes within `hops` of it along `edges`, either way,
 * extracted as the graph page extracts a perspective: the same elision,
 * encodings and edges, over that node set.
 */
export function extractNeighbourhood(
  run: EdnRunner,
  wireNodes: WireNode[],
  spec: NeighbourhoodSpec,
): GraphLens {
  const attributes = [...new Set(spec.edges.map(reachAttribute))];
  const ids = queryNeighbourhood(run, spec.root, spec.hops, attributes);
  const lens: LensPerspective = {
    id: spec.root,
    label: "",
    ...lensConfig({}),
    edgeKinds: [...spec.edges],
    focus: spec.root,
    hops: spec.hops,
  };
  return extractLensGraph(run, wireNodes, lens, { restrictTo: ids });
}
