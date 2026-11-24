/**
 * The nodes the graph draws: every node but the store's scaffolding
 * (`@kb/model`'s `isScaffolding`), a tag included as any node is. The
 * renderers' node set and every read over the projection take their nodes
 * from `visibleNodes`, so what a picture leaves out a trace never routes
 * through, and no degree counts it.
 */
import { isScaffolding } from "@kb/model";
import type { LensSource } from "./edges.ts";

/**
 * `nodes` as the graph shows them: without the scaffolding unless
 * `includeSystem`. A read anchored at a node walks from it whatever it is
 * (`read.ts`).
 */
export function visibleNodes<N extends Pick<LensSource, "id" | "props">>(
  nodes: readonly N[],
  { includeSystem = false }: { includeSystem?: boolean } = {},
): N[] {
  return includeSystem ? [...nodes] : nodes.filter((node) => !isScaffolding(node));
}
