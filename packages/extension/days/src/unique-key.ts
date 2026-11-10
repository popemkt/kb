/**
 * One node per period key (DESIGN.md → Days): a commit that would leave
 * two nodes holding one `sys.f.days.key` is refused, from every surface.
 * Only a write that sets or changes a key is looked at, so an ordinary
 * commit costs nothing.
 */
import { Effect } from "effect";
import type { ActionGuard } from "@kb/contracts";
import type { NodeLike, NodeWrite } from "@kb/model";
import { DAYS_IDS } from "./ids.ts";

function keyOf(node: Pick<NodeLike, "props"> | undefined): string | null {
  const value = node?.props[DAYS_IDS.keyField]?.[0];
  return value?.t === "str" ? value.v : null;
}

/**
 * The first key `writes` would leave on two nodes, given every node before
 * the commit, or null when each key stays on one node.
 */
export function duplicateKeyOf(
  writes: readonly NodeWrite[],
  held: Iterable<NodeLike>,
): { readonly key: string; readonly ids: readonly [string, string] } | null {
  const setsKey = writes.some(({ before, after }) => {
    const key = keyOf(after);
    return key !== null && key !== keyOf(before);
  });
  if (!setsKey) return null;
  const holders = new Map<string, string>();
  const written = new Set(writes.map((w) => (w.after ?? w.before)?.id));
  for (const node of held) {
    const key = keyOf(node);
    if (key !== null && !written.has(node.id)) holders.set(key, node.id);
  }
  for (const { after } of writes) {
    const key = keyOf(after);
    if (after === undefined || key === null) continue;
    const other = holders.get(key);
    if (other !== undefined && other !== after.id) return { key, ids: [other, after.id] };
    holders.set(key, after.id);
  }
  return null;
}

export const uniqueKeyGuard: Omit<ActionGuard, "match"> = {
  commit: (call) =>
    Effect.sync(() => {
      const duplicate = duplicateKeyOf(call.writes, call.ctx.nodes);
      return duplicate === null
        ? { decision: "allow" as const }
        : {
            decision: "deny" as const,
            rule: "days.unique-key",
            message: `${duplicate.key} is already ${duplicate.ids[0]}'s period: one node per day, week or year`,
          };
    }),
};
