/**
 * Taking a period's tag off takes its period with it (DESIGN.md → Days): a
 * `node.update` that leaves a keyed day, week or year no longer any of them
 * also unsets its key, in the same write. A node that stays a period keeps
 * its key and one that is no period holds none (`period-key.ts`), so
 * without this a person could neither untag a day nor take its key off,
 * and a day would be a lock in practice. With it, untagging makes a day an
 * ordinary node from every surface: the page's tag chip, the CLI, an agent.
 *
 * An interceptor transforms the input before the call runs, on the server
 * and in a tab alike, so the write the guards judge is the whole one. It
 * reads the input as `node.update` will (its own schema) and asks what the
 * update leaves through the action's own projection (`projectPropEdits`),
 * so it never disagrees with the write it adds to. It does nothing for a
 * node that holds no key, so an ordinary update costs one lookup.
 */
import { Effect } from "effect";
import type { ActionInterceptor, InterceptedCall } from "@kb/contracts";
import { IndexedNodes, type KbNode, type NodeLookup } from "@kb/model";
import { nodeUpdateDef, projectPropEdits } from "@kb/operations";
import { DAYS_IDS } from "./ids.ts";
import { keyValues, periodsOf } from "./period-key.ts";

/**
 * `input` with the key unset too when it leaves its node, a keyed period,
 * no period at all; otherwise `input` as given. `nodes` is every node, the
 * graph the update resolves its fields in.
 */
export function untaggedInput(
  input: unknown,
  nodes: readonly KbNode[],
  nodeOf: NodeLookup,
): unknown {
  const parsed = nodeUpdateDef.inputSchema.safeParse(input);
  // An input the action will refuse is the action's to refuse.
  if (!parsed.success || parsed.data.unsetProps === undefined) return input;
  const node = nodeOf(parsed.data.id);
  if (node === undefined || keyValues(node).length === 0 || periodsOf(node, nodeOf).length === 0)
    return input;
  const graph = IndexedNodes.of(nodes);
  let props: KbNode["props"];
  try {
    props = projectPropEdits(graph, node.props, parsed.data);
  } catch {
    // A field the update names and the graph does not hold: the action fails on its own.
    return input;
  }
  // The update already takes the key off, or leaves the node a period: nothing to add.
  if (keyValues({ props }).length === 0 || periodsOf({ props }, nodeOf).length > 0) return input;
  // The input as the action reads it, with the key's unset after its own.
  return { ...parsed.data, unsetProps: [...parsed.data.unsetProps, { field: DAYS_IDS.keyField }] };
}

export const untagPeriod: Omit<ActionInterceptor, "match"> = {
  input: (call: InterceptedCall) =>
    Effect.sync(() =>
      untaggedInput(call.invocation.input, call.ctx.nodes, (id) => call.ctx.index.getNode(id)),
    ),
};
