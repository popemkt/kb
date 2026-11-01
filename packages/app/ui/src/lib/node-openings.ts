/**
 * The ways this page can open a node: `nodeOpenings` (`@kb/views`, the one
 * list), less the view types this page does not draw as a page. The pane
 * switcher and the node menu's "Open with…" read it, so they offer the same.
 */
import type { Contribution } from "@kb/plugin";
import type { ProvidedView } from "@kb/ui-sdk";
import { nodeOpenings, type NodeOpening } from "@kb/views";

export function pageOpeningsOf(
  host: string,
  catalog: Parameters<typeof nodeOpenings>[1],
  views: readonly Contribution<ProvidedView>[],
  lookup: Parameters<typeof nodeOpenings>[2],
): NodeOpening[] {
  const paged = new Set(
    views.filter(({ value }) => value.placements.includes("page")).map(({ value }) => value.key),
  );
  return nodeOpenings(host, catalog, lookup).filter(
    ({ key }) => key === undefined || paged.has(key),
  );
}
