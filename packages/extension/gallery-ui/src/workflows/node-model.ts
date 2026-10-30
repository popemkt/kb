/**
 * "It is for something in kb", pure over the node set: the nodes a search
 * finds, a node's words as a plain brief to start from, and the looks
 * already made for it.
 */
import { GALLERY_IDS, isTagged, lookOf, type GraphNode } from "@kb/gallery";
import { replaceMentions } from "@kb/model";

/** What a look can be for: any node a person made, not the gallery's own looks and visuals. */
export function isPickable(node: GraphNode): boolean {
  return (
    !node.id.startsWith("sys.") &&
    node.text.trim() !== "" &&
    !isTagged(node, GALLERY_IDS.lookTag) &&
    !isTagged(node, GALLERY_IDS.visualTag)
  );
}

/** The nodes whose text holds `query`, in the order given, at most `limit`; none for no query. */
export function findNodes(
  nodes: Iterable<GraphNode>,
  query: string,
  limit = 50,
): readonly GraphNode[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return [];
  const found: GraphNode[] = [];
  for (const node of nodes) {
    if (!isPickable(node) || !node.text.toLowerCase().includes(needle)) continue;
    found.push(node);
    if (found.length === limit) break;
  }
  return found;
}

/** A node's text as plain words: references by their labels, media and markup dropped. */
export function plainOf(text: string, get: (id: string) => GraphNode | undefined): string {
  const named = replaceMentions(text, (span) => span.label ?? get(span.id)?.text ?? "");
  return named
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`~]+/g, "")
    .replace(/^\s*(?:#+|[-*+]|\d+\.)\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** How many of a node's children seed the brief. */
const SEED_CHILDREN = 4;

/** The brief a node seeds: its text, then its first children's, one line each. */
export function seedOf(node: GraphNode, get: (id: string) => GraphNode | undefined): string {
  const lines = [plainOf(node.text, get)];
  for (const id of node.children) {
    if (lines.length > SEED_CHILDREN) break;
    const child = get(id);
    const line = child === undefined ? "" : plainOf(child.text, get);
    if (line !== "") lines.push(line);
  }
  return lines.filter((line) => line !== "").join("\n");
}

/** The looks made for `nodeId` (their `for` refers to it), in the order given. */
export function looksFor(
  looks: readonly GraphNode[],
  nodeId: string,
  get: (id: string) => GraphNode | undefined,
): readonly GraphNode[] {
  return looks.filter((look) => lookOf(look, get).forNode === nodeId);
}
