import type { NodeMap } from "./types";

/**
 * Map raw datalog rows to result node ids: first column value per row that
 * names a known node. Dedupes, drops the query node itself, applies limit.
 */
export function resultNodeIds(
  rows: unknown[][],
  nodes: NodeMap,
  opts: { limit?: number | null; excludeId?: string } = {},
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const limit = opts.limit ?? null;
  for (const row of rows) {
    const id = row.find((v): v is string => typeof v === "string" && nodes.has(v));
    if (id === undefined || seen.has(id) || id === opts.excludeId) continue;
    seen.add(id);
    out.push(id);
    if (limit !== null && out.length >= limit) break;
  }
  return out;
}
