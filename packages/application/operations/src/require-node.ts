/**
 * The node an action names, or the action's refusal: the one reader every
 * action that reads one node by id goes through, so each refuses an id the
 * store does not hold with the same `not_found`.
 */
import type { KbContext } from "@kb/contracts";
import { ResolveError, type KbNode, type NodeId } from "@kb/model";
import type { NodeIndex } from "@kb/query";

export function requireNode(ctx: KbContext<NodeIndex>, id: NodeId): KbNode {
  const n = ctx.index.getNode(id);
  if (!n) throw new ResolveError("not_found", `node not found: ${id}`, { id });
  return n;
}
