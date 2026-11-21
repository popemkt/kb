import { nameIn, type OutlineNode, type SchemaIndex } from "@kb/ui-sdk";

/** One crumb: the node it opens and its name. */
export interface Crumb {
  readonly id: string;
  readonly text: string;
}

/**
 * The path from `home` down to `root`, `home` left out: an outline's crumbs,
 * each named by its row's name (`nameIn`, DESIGN.md → Display text), Untitled
 * when it has none.
 */
export function crumbsTo(
  root: string,
  home: string,
  nodes: ReadonlyMap<string, OutlineNode>,
  schema: SchemaIndex,
): Crumb[] {
  const chain: Crumb[] = [];
  const seen = new Set<string>();
  let id: string | null = root;
  while (id !== null && id !== home && !seen.has(id)) {
    seen.add(id);
    const node = nodes.get(id);
    if (node === undefined) break;
    chain.unshift({ id, text: nameIn(schema, id) || "Untitled" });
    id = node.parentId;
  }
  return chain;
}
