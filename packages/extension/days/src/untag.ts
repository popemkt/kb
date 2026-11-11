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
 * reads the update's fields as `node.update` does (`resolveFieldIn`), and
 * does nothing for a node that holds no key, so an ordinary update costs
 * one lookup.
 */
import { Effect } from "effect";
import type { ActionInterceptor, InterceptedCall } from "@kb/contracts";
import {
  ScannedNodes,
  SYSTEM_IDS,
  resolveFieldIn,
  typeRefsOf,
  type KbNode,
  type KindsLookup,
  type NodeLike,
  type PropValue,
} from "@kb/model";
import { DAYS_IDS } from "./ids.ts";
import { keyValues, periodsOf } from "./period-key.ts";

interface PropEdit {
  readonly field: string;
  readonly value?: unknown;
}

interface UpdateInput {
  readonly id: string;
  readonly setProps?: readonly PropEdit[];
  readonly unsetProps?: readonly PropEdit[];
}

function isUpdateInput(input: unknown): input is UpdateInput {
  return (
    typeof input === "object" && input !== null && "id" in input && typeof input.id === "string"
  );
}

const isRef = (value: unknown): value is Extract<PropValue, { t: "ref" }> =>
  typeof value === "object" && value !== null && "t" in value && value.t === "ref" && "v" in value;

/** The field an edit names, as `node.update` resolves it; null when it names none. */
function fieldOf(fields: ScannedNodes, edit: PropEdit): string | null {
  try {
    return resolveFieldIn(fields, edit.field);
  } catch {
    // The update fails on its own unknown field; it is not this one's to decide.
    return null;
  }
}

/** The tags `node` wears after `input`'s edits of `sys.f.type`, in the order `node.update` applies them. */
function tagsAfter(
  node: Pick<NodeLike, "props">,
  input: UpdateInput,
  fields: ScannedNodes,
): string[] {
  let tags = [...typeRefsOf(node)];
  for (const edit of input.unsetProps ?? []) {
    if (fieldOf(fields, edit) !== SYSTEM_IDS.typeField) continue;
    tags =
      edit.value === undefined
        ? []
        : tags.filter((tag) => !isRef(edit.value) || tag !== edit.value.v);
  }
  for (const edit of input.setProps ?? [])
    if (fieldOf(fields, edit) === SYSTEM_IDS.typeField && isRef(edit.value))
      tags.push(edit.value.v);
  return tags;
}

/**
 * `input` with the key unset too when it leaves its node, a keyed period,
 * no period at all; otherwise `input` as given. `nodes` is every node, read
 * only to resolve the update's field names.
 */
export function untaggedInput(
  input: unknown,
  nodes: readonly KbNode[],
  nodeOf: KindsLookup,
): unknown {
  if (!isUpdateInput(input) || (input.unsetProps ?? []).length === 0) return input;
  const node = nodeOf(input.id);
  if (node === undefined || keyValues(node).length === 0 || periodsOf(node, nodeOf).length === 0)
    return input;
  const fields = new ScannedNodes([...nodes]);
  const unsets = input.unsetProps ?? [];
  if (unsets.some((edit) => fieldOf(fields, edit) === DAYS_IDS.keyField)) return input;
  const tags = tagsAfter(node, input, fields).map((v) => ({ t: "ref" as const, v }));
  const after = { ...node, props: { ...node.props, [SYSTEM_IDS.typeField]: tags } };
  if (periodsOf(after, nodeOf).length > 0) return input;
  return { ...input, unsetProps: [...unsets, { field: DAYS_IDS.keyField }] };
}

export const untagPeriod: Omit<ActionInterceptor, "match"> = {
  input: (call: InterceptedCall) =>
    Effect.sync(() =>
      untaggedInput(call.invocation.input, call.ctx.nodes, (id) => call.ctx.index.getNode(id)),
    ),
};
