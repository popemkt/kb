/** The sidebar's Graph section, as rows: a pure selector, store fixtures in. */
import { nodeName } from "@kb/model";
import type { WireNode } from "@kb/contracts";
import type { EdnRunner, SidebarNavItem } from "@kb/ui-sdk";
import { listPerspectiveNodes } from "./graph-lens";

/** The graph view nodes (view nodes whose view is a renderer), for the Graph section. */
export function listPerspectiveNavItems(run: EdnRunner, wireNodes: WireNode[]): SidebarNavItem[] {
  const byId = new Map(wireNodes.map((n) => [n.id, n]));
  return listPerspectiveNodes(run, wireNodes).map((n) => ({
    id: n.id,
    label: nodeName(n.id, (id) => byId.get(id)) || n.id,
  }));
}
