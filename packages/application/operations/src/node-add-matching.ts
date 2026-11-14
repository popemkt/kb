/**
 * `node.add`'s `matching` (DESIGN.md → Query layer → What a match requires):
 * what a query node requires of a node added to match it. Its own module,
 * which `node.add` loads with the first matching add, so an add that matches
 * nothing (every one-shot `kb add` without `--matching`) parses no EDN.
 */
import { Effect } from "effect";
import { KbCtx } from "@kb/contracts";
import {
  domainError,
  IndexedNodes,
  queryTextOf,
  type DomainError,
  type NodeId,
  type PropValue,
} from "@kb/model";
import { readQuery, requirementsOf } from "@kb/query";

/** The part of `node.add`'s input a matching query adds to. */
interface MatchedInput {
  readonly parent?: NodeId | null | undefined;
  readonly tags?: string[] | undefined;
  readonly props?: { field: string; value: Exclude<PropValue, { t: "date" }> }[] | undefined;
}

/**
 * `input` with what the query node `matching` requires added: its tags and
 * values beside the input's own, and the parent a `child-of` names when the
 * input names none. A query that does not lift requires nothing and is one
 * unmet condition.
 */
export const withMatchingEffect = Effect.fn("node.add.matching")(function* <I extends MatchedInput>(
  input: I,
  matching: NodeId,
): Effect.fn.Return<{ input: I; unmet: number }, DomainError, KbCtx> {
  const ctx = yield* KbCtx;
  const graph = IndexedNodes.of(ctx.nodes);
  const query = graph.get(matching);
  const edn = queryTextOf(query);
  if (query === undefined || edn === null) {
    return yield* domainError("not_found", `no query node: ${matching}`, { id: matching });
  }
  const reading = readQuery(edn);
  if (!reading.lifted) return { input, unmet: 1 };
  const req = requirementsOf(reading.conditions, (id) => graph.get(id));
  return {
    input: {
      ...input,
      tags: [...(input.tags ?? []), ...req.tags],
      props: [...(input.props ?? []), ...req.props],
      ...(input.parent === undefined && req.parent !== null ? { parent: req.parent } : {}),
    },
    unmet: req.unmet.length,
  };
});
