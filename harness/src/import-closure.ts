import type { LazyFence } from "./constraints.ts";
import type { ImportKind } from "./import-graph.ts";

/** A resolved module edge, independent of any entry or host layout. */
export interface ImportClosureSite {
  file: string;
  specifier: string;
  kind: ImportKind;
  target: string | undefined;
}

/**
 * The fewest dynamic imports any path from `entry` crosses to reach each
 * file, with the path that does it (`a => b` for a lazy edge). Type-only
 * edges load nothing and are not paths.
 */
export function lazyDepths(
  sites: readonly ImportClosureSite[],
  entry: string,
): Map<string, { depth: number; chain: readonly string[] }> {
  const edges = new Map<string, Array<{ to: string; lazy: boolean }>>();
  for (const site of sites) {
    if (site.kind === "type" || site.target === undefined) continue;
    const from = edges.get(site.file) ?? [];
    from.push({ to: site.target, lazy: site.kind === "lazy" });
    edges.set(site.file, from);
  }
  // 0-1 breadth-first: an eager edge costs nothing, a lazy one costs one.
  const best = new Map<string, { depth: number; chain: readonly string[] }>([
    [entry, { depth: 0, chain: [entry] }],
  ]);
  const queue = [entry];
  for (let file = queue.shift(); file !== undefined; file = queue.shift()) {
    const here = best.get(file);
    if (here === undefined) continue;
    for (const { to, lazy } of edges.get(file) ?? []) {
      const depth = here.depth + (lazy ? 1 : 0);
      const known = best.get(to);
      if (known !== undefined && known.depth <= depth) continue;
      best.set(to, { depth, chain: [...here.chain, `${lazy ? "=>" : "->"} ${to}`] });
      if (lazy) queue.push(to);
      else queue.unshift(to);
    }
  }
  return best;
}

/** Breaches of one entry's forbidden-closure policy, with shortest witness paths. */
export function lazyFenceBreaches(sites: readonly ImportClosureSite[], fence: LazyFence): string[] {
  const depths = lazyDepths(sites, fence.entry);
  const out: string[] = [];
  for (const site of sites) {
    if (site.kind === "type") continue;
    if (
      !fence.forbidden.test(site.specifier) &&
      (site.target === undefined || !fence.forbidden.test(site.target))
    )
      continue;
    const reached = depths.get(site.file);
    if (reached === undefined) continue;
    const depth = reached.depth + (fence.boundary === "dependency" && site.kind === "lazy" ? 1 : 0);
    if (depth >= fence.depth) continue;
    out.push(`${reached.chain.join(" ")} ${site.kind === "lazy" ? "=>" : "->"} ${site.specifier}`);
  }
  return out.toSorted();
}
