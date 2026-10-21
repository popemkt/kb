/**
 * The browser's query seam. The page asks datalog of the replica's engine
 * through its query answers (`QueryAnswers`), never of a DataScript handle:
 * a reader gets a synchronous runner over the answers (`runner`, or the
 * `run` a `useAnswered` reader is handed), and every helper here takes that
 * runner, so the questions the UI asks are written once whatever answers
 * them.
 */
import { familyViewNodesQuery, type ViewFamily } from "@kb/model";
import { backlinksQuery, neighbourhoodQuery, type EdnRunner } from "@kb/query";

export type { EdnRunner, KbIndex, NodeIndex } from "@kb/query";
export { DatascriptIndex, derivedWith, queryRecords } from "@kb/query";
export type { QueryRecords } from "@kb/query";

/**
 * Nodes that reference `targetId`. The EDN comes from `@kb/query` —
 * one owner for "what references X", so the CLI's `kb backlinks` and the
 * UI's References section cannot answer it differently.
 */
export function queryBacklinks(
  run: EdnRunner,
  targetId: string,
): Array<{ id: string; text: string }> {
  return run(backlinksQuery(targetId)).flatMap((row: unknown[]) =>
    Array.isArray(row) && typeof row[0] === "string" && typeof row[1] === "string"
      ? [{ id: row[0], text: row[1] }]
      : [],
  );
}

/** The first column of `edn`'s rows, as the node ids they name. */
function queryIds(run: EdnRunner, edn: string): string[] {
  return run(edn).flatMap((row: unknown[]) =>
    Array.isArray(row) && typeof row[0] === "string" ? [row[0]] : [],
  );
}

/**
 * `root` and the nodes within `hops` of it along any of `edges` (node-valued
 * attributes), in either direction. The EDN is `@kb/query`'s
 * `neighbourhoodQuery`, run once per edge and direction and unioned here,
 * because the union as one query needs `or`, which runs raw.
 * GAP [[01M39X8RPQBWFVDNG77BB3ZCMH]]
 */
export function queryNeighbourhood(
  run: EdnRunner,
  root: string,
  hops: number,
  edges: readonly string[],
): Set<string> {
  const ids = new Set([root]);
  for (const edge of edges) {
    for (const direction of ["out", "in"] as const) {
      for (const id of queryIds(run, neighbourhoodQuery(root, hops, edge, direction))) ids.add(id);
    }
  }
  return ids;
}

/** The view nodes whose view is in `family` (`@kb/model`'s `familyViewNodesQuery`). */
export function queryFamilyViewNodes(run: EdnRunner, family: ViewFamily): string[] {
  return queryIds(run, familyViewNodesQuery(family));
}
